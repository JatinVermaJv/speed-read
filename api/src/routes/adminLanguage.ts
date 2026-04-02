import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  aiGenerationUsage,
  languageCourseTemplates,
  languageLessonTemplates,
  languageVocabTemplateItems,
} from "../db/schema";
import {
  generateLanguageCoursePlanWithOpenRouter,
  generateLessonVocabWithOpenRouter,
} from "../services/openrouterLanguage";
import { OpenRouterGenerationError } from "../services/openrouter";

const adminLanguageRouter = new Hono();

const generateTemplateSchema = z.object({
  targetLanguageCode: z.string().trim().min(2).max(20),
  level: z.string().trim().min(1).max(20).optional().default("A1"),
  lessonCount: z.number().int().min(3).max(30).optional().default(5),
});

const publishTemplateSchema = z.object({
  isPublished: z.boolean(),
});

const VOCAB_COUNT_PER_LESSON = 12;

function makeTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logPrefix(traceId?: string) {
  return traceId ? `[admin:language:${traceId}]` : "[admin:language]";
}

function logInfo(
  traceId: string | undefined,
  message: string,
  meta?: Record<string, unknown>
) {
  if (meta) {
    console.log(logPrefix(traceId), message, meta);
    return;
  }
  console.log(logPrefix(traceId), message);
}

function logError(
  traceId: string | undefined,
  message: string,
  meta?: Record<string, unknown>
) {
  if (meta) {
    console.error(logPrefix(traceId), message, meta);
    return;
  }
  console.error(logPrefix(traceId), message);
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: typeof error,
    message: String(error),
  };
}

function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

adminLanguageRouter.get("/templates", async (c) => {
  const rows = await db
    .select({
      id: languageCourseTemplates.id,
      targetLanguageCode: languageCourseTemplates.targetLanguageCode,
      level: languageCourseTemplates.level,
      title: languageCourseTemplates.title,
      isPublished: languageCourseTemplates.isPublished,
      publishedAt: languageCourseTemplates.publishedAt,
      createdAt: languageCourseTemplates.createdAt,
      updatedAt: languageCourseTemplates.updatedAt,
      lessonCount: count(languageLessonTemplates.id),
    })
    .from(languageCourseTemplates)
    .leftJoin(
      languageLessonTemplates,
      eq(languageLessonTemplates.courseTemplateId, languageCourseTemplates.id)
    )
    .groupBy(languageCourseTemplates.id)
    .orderBy(desc(languageCourseTemplates.createdAt));

  return c.json({
    templates: rows.map((row) => ({
      id: row.id,
      targetLanguageCode: row.targetLanguageCode,
      level: row.level,
      title: row.title,
      isPublished: row.isPublished,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lessonCount: Number(row.lessonCount) || 0,
    })),
  });
});

adminLanguageRouter.post(
  "/templates/generate",
  zValidator("json", generateTemplateSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const body = c.req.valid("json");

    const traceId = makeTraceId();
    const startedAt = Date.now();

    const targetLanguageCode = sanitizeText(body.targetLanguageCode);
    const level = sanitizeText(body.level);
    const lessonCount = body.lessonCount;

    logInfo(traceId, "templates.generate.start", {
      userId,
      targetLanguageCode,
      level,
      lessonCount,
    });

    let planModel = "";
    let courseTitle = "";
    let lessons: Array<{ title: string; objective: string }> = [];

    const planStartedAt = Date.now();
    try {
      const generatedPlan = await generateLanguageCoursePlanWithOpenRouter({
        targetLanguageCode,
        level,
        lessonCount,
        traceId,
      });

      planModel = generatedPlan.model;
      courseTitle = sanitizeText(generatedPlan.courseTitle);
      lessons = generatedPlan.lessons.map((l) => ({
        title: sanitizeText(l.title),
        objective: sanitizeText(l.objective),
      }));

      logInfo(traceId, "templates.generate.plan.success", {
        model: planModel,
        courseTitle,
        lessons: lessons.length,
        durationMs: Date.now() - planStartedAt,
      });
    } catch (error) {
      const attemptedModels =
        error instanceof OpenRouterGenerationError ? error.attemptedModels : [];
      const errorMessage = error instanceof Error ? error.message : String(error);

      logError(traceId, "templates.generate.plan.failed", {
        attemptedModels,
        error: formatUnknownError(error),
        durationMs: Date.now() - planStartedAt,
      });

      await db.insert(aiGenerationUsage).values({
        userId,
        feature: "language_course_template_plan",
        theme: "language_course_template_plan",
        keywords: `${targetLanguageCode}|${level}|${lessonCount}`,
        model: attemptedModels[0] || "none",
        status: "failed",
        errorMessage,
        metadata: JSON.stringify({ traceId }),
      });

      return c.json(
        {
          error: "generation_failed",
          message: "Failed to generate course plan. Please retry.",
          traceId,
        },
        503
      );
    }

    const vocabByLesson: Array<{ model: string; vocab: Array<{
      term: string;
      translation: string;
      partOfSpeech?: string;
      targetExample?: string;
      nativeExample?: string;
    }> }> = [];

    const vocabStartedAt = Date.now();
    try {
      for (const [idx, lesson] of lessons.entries()) {
        const lessonStartedAt = Date.now();

        logInfo(traceId, "templates.generate.vocab.lesson.start", {
          lessonIndex: idx + 1,
          lessonTitle: lesson.title,
          vocabCount: VOCAB_COUNT_PER_LESSON,
        });

        const generatedVocab = await generateLessonVocabWithOpenRouter({
          targetLanguageCode,
          level,
          lessonTitle: lesson.title,
          lessonObjective: lesson.objective,
          vocabCount: VOCAB_COUNT_PER_LESSON,
          traceId,
        });

        vocabByLesson.push({
          model: generatedVocab.model,
          vocab: generatedVocab.vocab,
        });

        logInfo(traceId, "templates.generate.vocab.lesson.success", {
          lessonIndex: idx + 1,
          model: generatedVocab.model,
          vocabItems: generatedVocab.vocab.length,
          durationMs: Date.now() - lessonStartedAt,
        });
      }

      logInfo(traceId, "templates.generate.vocab.success", {
        lessons: lessons.length,
        vocabItemsPerLesson: VOCAB_COUNT_PER_LESSON,
        durationMs: Date.now() - vocabStartedAt,
      });
    } catch (error) {
      const attemptedModels =
        error instanceof OpenRouterGenerationError ? error.attemptedModels : [];
      const errorMessage = error instanceof Error ? error.message : String(error);

      logError(traceId, "templates.generate.vocab.failed", {
        attemptedModels,
        error: formatUnknownError(error),
        durationMs: Date.now() - vocabStartedAt,
      });

      await db.insert(aiGenerationUsage).values({
        userId,
        feature: "language_course_template_vocab",
        theme: "language_course_template_vocab",
        keywords: `${targetLanguageCode}|${level}|${lessonCount}`,
        model: attemptedModels[0] || "none",
        status: "failed",
        errorMessage,
        metadata: JSON.stringify({ traceId }),
      });

      return c.json(
        {
          error: "generation_failed",
          message: "Failed to generate lesson vocabulary. Please retry.",
          traceId,
        },
        503
      );
    }

    logInfo(traceId, "templates.generate.db.start");

    let created: {
      template: {
        id: string;
        targetLanguageCode: string;
        level: string;
        title: string;
        isPublished: boolean;
        publishedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      };
      lessons: Array<{ id: string; orderIndex: number; title: string; objective: string }>;
      vocabItemsInserted: number;
    };

    try {
      created = await db.transaction(async (tx) => {
        const now = new Date();

      const [template] = await tx
        .insert(languageCourseTemplates)
        .values({
          createdBy: userId,
          targetLanguageCode,
          level,
          title: courseTitle,
          isPublished: false,
          publishedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: languageCourseTemplates.id,
          targetLanguageCode: languageCourseTemplates.targetLanguageCode,
          level: languageCourseTemplates.level,
          title: languageCourseTemplates.title,
          isPublished: languageCourseTemplates.isPublished,
          publishedAt: languageCourseTemplates.publishedAt,
          createdAt: languageCourseTemplates.createdAt,
          updatedAt: languageCourseTemplates.updatedAt,
        });

      if (!template) {
        throw new Error("Failed to create template");
      }

      const lessonRows = await tx
        .insert(languageLessonTemplates)
        .values(
          lessons.map((lesson, index) => ({
            courseTemplateId: template.id,
            orderIndex: index + 1,
            title: lesson.title,
            objective: lesson.objective,
            createdAt: now,
            updatedAt: now,
          }))
        )
        .returning({
          id: languageLessonTemplates.id,
          orderIndex: languageLessonTemplates.orderIndex,
          title: languageLessonTemplates.title,
          objective: languageLessonTemplates.objective,
        });

      const lessonIdByOrder = new Map<number, string>();
      for (const row of lessonRows) {
        lessonIdByOrder.set(row.orderIndex, row.id);
      }

      const vocabInserts: Array<{
        lessonTemplateId: string;
        orderIndex: number;
        term: string;
        translation: string;
        partOfSpeech: string | null;
        targetExample: string | null;
        nativeExample: string | null;
        createdAt: Date;
      }> = [];

      lessonRows
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .forEach((lessonRow, lessonIndex) => {
          const vocabPayload = vocabByLesson[lessonIndex];
          const lessonTemplateId = lessonIdByOrder.get(lessonRow.orderIndex);

          if (!vocabPayload || !lessonTemplateId) return;

          vocabPayload.vocab.forEach((item, vocabIndex) => {
            vocabInserts.push({
              lessonTemplateId,
              orderIndex: vocabIndex + 1,
              term: sanitizeText(item.term),
              translation: sanitizeText(item.translation),
              partOfSpeech: item.partOfSpeech ? sanitizeText(item.partOfSpeech) : null,
              targetExample: item.targetExample ? sanitizeText(item.targetExample) : null,
              nativeExample: item.nativeExample ? sanitizeText(item.nativeExample) : null,
              createdAt: now,
            });
          });
        });

      if (vocabInserts.length > 0) {
        await tx.insert(languageVocabTemplateItems).values(vocabInserts);
      }

      return {
        template,
        lessons: lessonRows
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((l) => ({
            id: l.id,
            orderIndex: l.orderIndex,
            title: l.title,
            objective: l.objective,
          })),
        vocabItemsInserted: vocabInserts.length,
      };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logError(traceId, "templates.generate.db.failed", {
        error: formatUnknownError(error),
        durationMs: Date.now() - startedAt,
      });

      await db.insert(aiGenerationUsage).values({
        userId,
        feature: "language_course_template_generate",
        theme: "language_course_template_generate",
        keywords: `${targetLanguageCode}|${level}|${lessonCount}`,
        model: planModel || "unknown",
        status: "failed",
        errorMessage,
        metadata: JSON.stringify({ traceId, stage: "db" }),
      });

      return c.json(
        {
          error: "internal_server_error",
          message: "Failed to save language template. Please retry.",
          traceId,
        },
        500
      );
    }

    await db.insert(aiGenerationUsage).values({
      userId,
      feature: "language_course_template_generate",
      theme: "language_course_template_generate",
      keywords: `${targetLanguageCode}|${level}|${lessonCount}`,
      model: planModel || "unknown",
      status: "success",
      errorMessage: null,
      metadata: JSON.stringify({
        traceId,
        templateId: created.template.id,
        planModel,
        vocabModels: vocabByLesson.map((v) => v.model),
        lessonCount: body.lessonCount,
        vocabCountPerLesson: VOCAB_COUNT_PER_LESSON,
        durationMs: Date.now() - startedAt,
      }),
    });

    logInfo(traceId, "templates.generate.success", {
      templateId: created.template.id,
      lessons: created.lessons.length,
      vocabItemsInserted: created.vocabItemsInserted,
      planModel,
      vocabModels: vocabByLesson.map((v) => v.model),
      durationMs: Date.now() - startedAt,
    });

    return c.json(
      {
        traceId,
        durationMs: Date.now() - startedAt,
        template: {
          ...created.template,
          publishedAt: created.template.publishedAt
            ? created.template.publishedAt.toISOString()
            : null,
          createdAt: created.template.createdAt.toISOString(),
          updatedAt: created.template.updatedAt.toISOString(),
        },
        lessons: created.lessons,
        vocabCountPerLesson: VOCAB_COUNT_PER_LESSON,
      },
      201
    );
  }
);

adminLanguageRouter.patch(
  "/templates/:templateId/publish",
  zValidator("json", publishTemplateSchema),
  async (c) => {
    const templateId = c.req.param("templateId");
    const { isPublished } = c.req.valid("json");

    const [existing] = await db
      .select({
        id: languageCourseTemplates.id,
        isPublished: languageCourseTemplates.isPublished,
      })
      .from(languageCourseTemplates)
      .where(eq(languageCourseTemplates.id, templateId))
      .limit(1);

    if (!existing) {
      return c.json({ error: "not_found", message: "Template not found" }, 404);
    }

    const now = new Date();

    await db
      .update(languageCourseTemplates)
      .set({
        isPublished,
        publishedAt: isPublished ? now : null,
        updatedAt: now,
      })
      .where(eq(languageCourseTemplates.id, templateId));

    return c.json({
      templateId,
      isPublished,
      message: `Template ${isPublished ? "published" : "unpublished"}`,
    });
  }
);

adminLanguageRouter.delete("/templates/:templateId", async (c) => {
  const templateId = c.req.param("templateId");

  const [existing] = await db
    .select({ id: languageCourseTemplates.id })
    .from(languageCourseTemplates)
    .where(eq(languageCourseTemplates.id, templateId))
    .limit(1);

  if (!existing) {
    return c.json({ error: "not_found", message: "Template not found" }, 404);
  }

  await db
    .delete(languageCourseTemplates)
    .where(eq(languageCourseTemplates.id, templateId));

  return c.json({ message: "Template deleted", templateId });
});

// Admin helper: show a template with its lessons (for quick review in UI)
adminLanguageRouter.get("/templates/:templateId", async (c) => {
  const templateId = c.req.param("templateId");

  const [template] = await db
    .select({
      id: languageCourseTemplates.id,
      targetLanguageCode: languageCourseTemplates.targetLanguageCode,
      level: languageCourseTemplates.level,
      title: languageCourseTemplates.title,
      isPublished: languageCourseTemplates.isPublished,
      publishedAt: languageCourseTemplates.publishedAt,
      createdAt: languageCourseTemplates.createdAt,
      updatedAt: languageCourseTemplates.updatedAt,
    })
    .from(languageCourseTemplates)
    .where(eq(languageCourseTemplates.id, templateId))
    .limit(1);

  if (!template) {
    return c.json({ error: "not_found", message: "Template not found" }, 404);
  }

  const lessons = await db
    .select({
      id: languageLessonTemplates.id,
      orderIndex: languageLessonTemplates.orderIndex,
      title: languageLessonTemplates.title,
      objective: languageLessonTemplates.objective,
      vocabCount: count(languageVocabTemplateItems.id),
    })
    .from(languageLessonTemplates)
    .leftJoin(
      languageVocabTemplateItems,
      eq(languageVocabTemplateItems.lessonTemplateId, languageLessonTemplates.id)
    )
    .where(eq(languageLessonTemplates.courseTemplateId, templateId))
    .groupBy(languageLessonTemplates.id)
    .orderBy(asc(languageLessonTemplates.orderIndex));

  return c.json({
    template: {
      ...template,
      publishedAt: template.publishedAt ? template.publishedAt.toISOString() : null,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    },
    lessons: lessons.map((l) => ({
      id: l.id,
      orderIndex: l.orderIndex,
      title: l.title,
      objective: l.objective,
      vocabCount: Number(l.vocabCount) || 0,
    })),
  });
});

export default adminLanguageRouter;
