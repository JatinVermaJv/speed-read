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

    let planModel = "";
    let courseTitle = "";
    let lessons: Array<{ title: string; objective: string }> = [];

    try {
      const generatedPlan = await generateLanguageCoursePlanWithOpenRouter({
        targetLanguageCode: body.targetLanguageCode,
        level: body.level,
        lessonCount: body.lessonCount,
        traceId,
      });

      planModel = generatedPlan.model;
      courseTitle = sanitizeText(generatedPlan.courseTitle);
      lessons = generatedPlan.lessons.map((l) => ({
        title: sanitizeText(l.title),
        objective: sanitizeText(l.objective),
      }));
    } catch (error) {
      const attemptedModels =
        error instanceof OpenRouterGenerationError ? error.attemptedModels : [];
      const errorMessage = error instanceof Error ? error.message : String(error);

      await db.insert(aiGenerationUsage).values({
        userId,
        feature: "language_course_template_plan",
        theme: "language_course_template_plan",
        keywords: `${body.targetLanguageCode}|${body.level}|${body.lessonCount}`,
        model: attemptedModels[0] || "none",
        status: "failed",
        errorMessage,
        metadata: JSON.stringify({ traceId }),
      });

      return c.json(
        {
          error: "generation_failed",
          message: "Failed to generate course plan. Please retry.",
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

    try {
      for (const lesson of lessons) {
        const generatedVocab = await generateLessonVocabWithOpenRouter({
          targetLanguageCode: body.targetLanguageCode,
          level: body.level,
          lessonTitle: lesson.title,
          lessonObjective: lesson.objective,
          vocabCount: VOCAB_COUNT_PER_LESSON,
          traceId,
        });

        vocabByLesson.push({
          model: generatedVocab.model,
          vocab: generatedVocab.vocab,
        });
      }
    } catch (error) {
      const attemptedModels =
        error instanceof OpenRouterGenerationError ? error.attemptedModels : [];
      const errorMessage = error instanceof Error ? error.message : String(error);

      await db.insert(aiGenerationUsage).values({
        userId,
        feature: "language_course_template_vocab",
        theme: "language_course_template_vocab",
        keywords: `${body.targetLanguageCode}|${body.level}|${body.lessonCount}`,
        model: attemptedModels[0] || "none",
        status: "failed",
        errorMessage,
        metadata: JSON.stringify({ traceId }),
      });

      return c.json(
        {
          error: "generation_failed",
          message: "Failed to generate lesson vocabulary. Please retry.",
        },
        503
      );
    }

    const created = await db.transaction(async (tx) => {
      const now = new Date();

      const [template] = await tx
        .insert(languageCourseTemplates)
        .values({
          createdBy: userId,
          targetLanguageCode: sanitizeText(body.targetLanguageCode),
          level: sanitizeText(body.level),
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
      };
    });

    await db.insert(aiGenerationUsage).values({
      userId,
      feature: "language_course_template_generate",
      theme: "language_course_template_generate",
      keywords: `${body.targetLanguageCode}|${body.level}|${body.lessonCount}`,
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

    return c.json(
      {
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
