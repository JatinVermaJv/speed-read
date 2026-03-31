import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
} from "drizzle-orm";
import { db } from "../db";
import {
  languageAttemptAnswers,
  languageAttempts,
  languageCourseTemplates,
  languageCourses,
  languageExerciseOptions,
  languageExercises,
  languageLessonTemplates,
  languageLessons,
  languageVocabItems,
  languageVocabTemplateItems,
  users,
} from "../db/schema";
import { authMiddleware } from "../middleware/auth";

const languageRouter = new Hono();

languageRouter.use("/*", authMiddleware);

const enrollSchema = z.object({
  templateId: z.string().uuid(),
});

const submitAttemptSchema = z.object({
  answers: z
    .array(
      z.object({
        exerciseId: z.string().uuid(),
        selectedOptionId: z.string().uuid().nullable().optional(),
        typedText: z.string().max(400).nullable().optional(),
      })
    )
    .min(1)
    .superRefine((answers, ctx) => {
      const seen = new Set<string>();
      for (const ans of answers) {
        if (seen.has(ans.exerciseId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate exerciseId found in answers",
          });
          return;
        }
        seen.add(ans.exerciseId);
      }
    }),
});

type LessonStatus = "locked" | "available" | "completed";

function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function normalizeForCompare(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

function computeExerciseCounts(vocabSize: number): { mcq: number; typing: number; listening: number } {
  if (vocabSize >= 8) return { mcq: 3, typing: 3, listening: 2 };
  if (vocabSize === 7) return { mcq: 3, typing: 2, listening: 2 };
  if (vocabSize === 6) return { mcq: 2, typing: 2, listening: 2 };
  if (vocabSize === 5) return { mcq: 2, typing: 2, listening: 1 };
  return { mcq: 1, typing: 1, listening: 0 };
}

async function getUserCourses(userId: string) {
  const rows = await db
    .select({
      id: languageCourses.id,
      templateId: languageCourses.templateId,
      userId: languageCourses.userId,
      targetLanguageCode: languageCourses.targetLanguageCode,
      level: languageCourses.level,
      title: languageCourses.title,
      status: languageCourses.status,
      createdAt: languageCourses.createdAt,
      updatedAt: languageCourses.updatedAt,
    })
    .from(languageCourses)
    .where(eq(languageCourses.userId, userId))
    .orderBy(desc(languageCourses.createdAt));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function getPublishedTemplates() {
  const rows = await db
    .select({
      id: languageCourseTemplates.id,
      targetLanguageCode: languageCourseTemplates.targetLanguageCode,
      level: languageCourseTemplates.level,
      title: languageCourseTemplates.title,
      createdAt: languageCourseTemplates.createdAt,
      updatedAt: languageCourseTemplates.updatedAt,
      lessonCount: count(languageLessonTemplates.id),
    })
    .from(languageCourseTemplates)
    .leftJoin(
      languageLessonTemplates,
      eq(languageLessonTemplates.courseTemplateId, languageCourseTemplates.id)
    )
    .where(eq(languageCourseTemplates.isPublished, true))
    .groupBy(languageCourseTemplates.id)
    .orderBy(asc(languageCourseTemplates.title));

  return rows.map((row) => ({
    id: row.id,
    targetLanguageCode: row.targetLanguageCode,
    level: row.level,
    title: row.title,
    lessonCount: Number(row.lessonCount) || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function getCourseForUser(userId: string, courseId: string) {
  const [course] = await db
    .select({
      id: languageCourses.id,
      templateId: languageCourses.templateId,
      userId: languageCourses.userId,
      targetLanguageCode: languageCourses.targetLanguageCode,
      level: languageCourses.level,
      title: languageCourses.title,
      status: languageCourses.status,
      createdAt: languageCourses.createdAt,
      updatedAt: languageCourses.updatedAt,
    })
    .from(languageCourses)
    .where(and(eq(languageCourses.id, courseId), eq(languageCourses.userId, userId)))
    .limit(1);

  if (!course) return null;

  return {
    ...course,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

async function getLessonsForCourse(courseId: string) {
  const rows = await db
    .select({
      id: languageLessons.id,
      courseId: languageLessons.courseId,
      orderIndex: languageLessons.orderIndex,
      title: languageLessons.title,
      objective: languageLessons.objective,
      status: languageLessons.status,
      createdAt: languageLessons.createdAt,
      updatedAt: languageLessons.updatedAt,
    })
    .from(languageLessons)
    .where(eq(languageLessons.courseId, courseId))
    .orderBy(asc(languageLessons.orderIndex));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function ensureLessonExercises(lessonId: string) {
  const existingCountRows = await db
    .select({ total: count(languageExercises.id) })
    .from(languageExercises)
    .where(eq(languageExercises.lessonId, lessonId));

  const existingTotal = Number(existingCountRows[0]?.total || 0);
  if (existingTotal > 0) {
    return;
  }

  const vocab = await db
    .select({
      id: languageVocabItems.id,
      orderIndex: languageVocabItems.orderIndex,
      term: languageVocabItems.term,
      translation: languageVocabItems.translation,
    })
    .from(languageVocabItems)
    .where(eq(languageVocabItems.lessonId, lessonId))
    .orderBy(asc(languageVocabItems.orderIndex));

  if (vocab.length < 5) {
    throw new Error("Lesson vocabulary is incomplete");
  }

  const counts = computeExerciseCounts(vocab.length);
  const picked = shuffle(vocab);

  const mcqItems = picked.slice(0, counts.mcq);
  const typingItems = picked.slice(counts.mcq, counts.mcq + counts.typing);
  const listeningItems = picked.slice(
    counts.mcq + counts.typing,
    counts.mcq + counts.typing + counts.listening
  );

  const exerciseInserts: Array<{
    lessonId: string;
    type: string;
    orderIndex: number;
    prompt: string;
    vocabItemId: string;
  }> = [];

  let order = 1;
  for (const item of mcqItems) {
    exerciseInserts.push({
      lessonId,
      type: "mcq",
      orderIndex: order,
      prompt: item.term,
      vocabItemId: item.id,
    });
    order += 1;
  }

  for (const item of typingItems) {
    exerciseInserts.push({
      lessonId,
      type: "typing",
      orderIndex: order,
      prompt: item.translation,
      vocabItemId: item.id,
    });
    order += 1;
  }

  for (const item of listeningItems) {
    exerciseInserts.push({
      lessonId,
      type: "listening",
      orderIndex: order,
      prompt: item.term,
      vocabItemId: item.id,
    });
    order += 1;
  }

  const createdExercises = await db
    .insert(languageExercises)
    .values(exerciseInserts)
    .returning({
      id: languageExercises.id,
      type: languageExercises.type,
      vocabItemId: languageExercises.vocabItemId,
    });

  const optionInserts: Array<{
    exerciseId: string;
    vocabItemId: string;
    orderIndex: number;
  }> = [];

  for (const ex of createdExercises) {
    if (ex.type !== "mcq" && ex.type !== "listening") {
      continue;
    }

    const correct = vocab.find((v) => v.id === ex.vocabItemId);
    if (!correct) {
      throw new Error("Exercise configuration is invalid");
    }

    const distractors = shuffle(vocab.filter((v) => v.id !== correct.id)).slice(0, 3);
    const options = shuffle([correct, ...distractors]);

    options.forEach((opt, idx) => {
      optionInserts.push({
        exerciseId: ex.id,
        vocabItemId: opt.id,
        orderIndex: idx + 1,
      });
    });
  }

  if (optionInserts.length > 0) {
    await db.insert(languageExerciseOptions).values(optionInserts);
  }
}

// ─── Catalog (published templates + user's courses) ────────────────────────

languageRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const [templates, courses] = await Promise.all([
    getPublishedTemplates(),
    getUserCourses(userId),
  ]);

  return c.json({ templates, courses });
});

// ─── Course detail (user-owned) ───────────────────────────────────────────

languageRouter.get("/courses/:courseId", async (c) => {
  const userId = c.get("userId") as string;
  const courseId = c.req.param("courseId");

  const course = await getCourseForUser(userId, courseId);
  if (!course) {
    return c.json({ error: "not_found", message: "Course not found" }, 404);
  }

  const lessons = await getLessonsForCourse(courseId);
  return c.json({ course, lessons });
});

// ─── Enroll into a published template (clones into user tables) ────────────

languageRouter.post(
  "/enroll",
  zValidator("json", enrollSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const { templateId } = c.req.valid("json");

    const [existingCourse] = await db
      .select({
        id: languageCourses.id,
        userId: languageCourses.userId,
        templateId: languageCourses.templateId,
        targetLanguageCode: languageCourses.targetLanguageCode,
        level: languageCourses.level,
        title: languageCourses.title,
        status: languageCourses.status,
        createdAt: languageCourses.createdAt,
        updatedAt: languageCourses.updatedAt,
      })
      .from(languageCourses)
      .where(
        and(
          eq(languageCourses.userId, userId),
          eq(languageCourses.templateId, templateId),
          eq(languageCourses.status, "active")
        )
      )
      .orderBy(desc(languageCourses.createdAt))
      .limit(1);

    if (existingCourse) {
      const lessons = await getLessonsForCourse(existingCourse.id);
      return c.json({
        enrolled: false,
        course: {
          ...existingCourse,
          createdAt: existingCourse.createdAt.toISOString(),
          updatedAt: existingCourse.updatedAt.toISOString(),
        },
        lessons,
      });
    }

    const [template] = await db
      .select({
        id: languageCourseTemplates.id,
        targetLanguageCode: languageCourseTemplates.targetLanguageCode,
        level: languageCourseTemplates.level,
        title: languageCourseTemplates.title,
        isPublished: languageCourseTemplates.isPublished,
      })
      .from(languageCourseTemplates)
      .where(eq(languageCourseTemplates.id, templateId))
      .limit(1);

    if (!template) {
      return c.json({ error: "not_found", message: "Template not found" }, 404);
    }

    if (!template.isPublished) {
      const [userRow] = await db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRow?.isAdmin) {
        return c.json(
          { error: "forbidden", message: "Template is not published" },
          403
        );
      }
    }

    const lessonTemplates = await db
      .select({
        id: languageLessonTemplates.id,
        orderIndex: languageLessonTemplates.orderIndex,
        title: languageLessonTemplates.title,
        objective: languageLessonTemplates.objective,
      })
      .from(languageLessonTemplates)
      .where(eq(languageLessonTemplates.courseTemplateId, templateId))
      .orderBy(asc(languageLessonTemplates.orderIndex));

    if (lessonTemplates.length === 0) {
      return c.json(
        { error: "template_incomplete", message: "Template has no lessons" },
        409
      );
    }

    const vocabTemplates = await db
      .select({
        lessonOrderIndex: languageLessonTemplates.orderIndex,
        orderIndex: languageVocabTemplateItems.orderIndex,
        term: languageVocabTemplateItems.term,
        translation: languageVocabTemplateItems.translation,
        partOfSpeech: languageVocabTemplateItems.partOfSpeech,
        targetExample: languageVocabTemplateItems.targetExample,
        nativeExample: languageVocabTemplateItems.nativeExample,
      })
      .from(languageVocabTemplateItems)
      .innerJoin(
        languageLessonTemplates,
        eq(languageLessonTemplates.id, languageVocabTemplateItems.lessonTemplateId)
      )
      .where(eq(languageLessonTemplates.courseTemplateId, templateId))
      .orderBy(
        asc(languageLessonTemplates.orderIndex),
        asc(languageVocabTemplateItems.orderIndex)
      );

    const vocabCountByLesson = new Map<number, number>();
    for (const row of vocabTemplates) {
      vocabCountByLesson.set(
        row.lessonOrderIndex,
        (vocabCountByLesson.get(row.lessonOrderIndex) || 0) + 1
      );
    }

    for (const lesson of lessonTemplates) {
      const countForLesson = vocabCountByLesson.get(lesson.orderIndex) || 0;
      if (countForLesson < 5) {
        return c.json(
          {
            error: "template_incomplete",
            message: `Template lesson ${lesson.orderIndex} is missing vocabulary`,
          },
          409
        );
      }
    }

    const created = await db.transaction(async (tx) => {
      const now = new Date();

      const [courseRow] = await tx
        .insert(languageCourses)
        .values({
          templateId: template.id,
          userId,
          targetLanguageCode: template.targetLanguageCode,
          level: template.level,
          title: template.title,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: languageCourses.id,
          createdAt: languageCourses.createdAt,
          updatedAt: languageCourses.updatedAt,
        });

      if (!courseRow) {
        throw new Error("Failed to create course");
      }

      const insertedLessons = await tx
        .insert(languageLessons)
        .values(
          lessonTemplates.map((lesson, idx) => ({
            courseId: courseRow.id,
            orderIndex: lesson.orderIndex,
            title: lesson.title,
            objective: lesson.objective,
            status: (idx === 0 ? "available" : "locked") as LessonStatus,
            createdAt: now,
            updatedAt: now,
          }))
        )
        .returning({
          id: languageLessons.id,
          orderIndex: languageLessons.orderIndex,
        });

      const lessonIdByOrder = new Map<number, string>();
      for (const row of insertedLessons) {
        lessonIdByOrder.set(row.orderIndex, row.id);
      }

      const vocabInserts = vocabTemplates
        .map((row) => {
          const lessonId = lessonIdByOrder.get(row.lessonOrderIndex);
          if (!lessonId) return null;
          return {
            lessonId,
            orderIndex: row.orderIndex,
            term: row.term,
            translation: row.translation,
            partOfSpeech: row.partOfSpeech,
            targetExample: row.targetExample,
            nativeExample: row.nativeExample,
            createdAt: now,
          };
        })
        .filter(Boolean) as Array<{
        lessonId: string;
        orderIndex: number;
        term: string;
        translation: string;
        partOfSpeech: string | null;
        targetExample: string | null;
        nativeExample: string | null;
        createdAt: Date;
      }>;

      if (vocabInserts.length > 0) {
        await tx.insert(languageVocabItems).values(vocabInserts);
      }

      return {
        id: courseRow.id,
        createdAt: courseRow.createdAt,
        updatedAt: courseRow.updatedAt,
      };
    });

    const lessons = await getLessonsForCourse(created.id);

    return c.json(
      {
        enrolled: true,
        course: {
          id: created.id,
          templateId: template.id,
          userId,
          targetLanguageCode: template.targetLanguageCode,
          level: template.level,
          title: template.title,
          status: "active",
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
        lessons,
      },
      201
    );
  }
);

// ─── Start a lesson attempt (ensures vocab + exercises) ─────────────────────

languageRouter.post("/lessons/:lessonId/start", async (c) => {
  const userId = c.get("userId") as string;
  const lessonId = c.req.param("lessonId");

  const [lesson] = await db
    .select({
      lessonId: languageLessons.id,
      courseId: languageLessons.courseId,
      lessonTitle: languageLessons.title,
      lessonObjective: languageLessons.objective,
      lessonStatus: languageLessons.status,
      lessonOrder: languageLessons.orderIndex,
      targetLanguageCode: languageCourses.targetLanguageCode,
      level: languageCourses.level,
      courseTitle: languageCourses.title,
    })
    .from(languageLessons)
    .innerJoin(languageCourses, eq(languageCourses.id, languageLessons.courseId))
    .where(and(eq(languageLessons.id, lessonId), eq(languageCourses.userId, userId)))
    .limit(1);

  if (!lesson) {
    return c.json({ error: "not_found", message: "Lesson not found" }, 404);
  }

  if (lesson.lessonStatus === "locked") {
    return c.json(
      { error: "forbidden", message: "Lesson is locked" },
      403
    );
  }

  const vocab = await db
    .select({
      id: languageVocabItems.id,
      orderIndex: languageVocabItems.orderIndex,
      term: languageVocabItems.term,
      translation: languageVocabItems.translation,
      partOfSpeech: languageVocabItems.partOfSpeech,
      targetExample: languageVocabItems.targetExample,
      nativeExample: languageVocabItems.nativeExample,
    })
    .from(languageVocabItems)
    .where(eq(languageVocabItems.lessonId, lesson.lessonId))
    .orderBy(asc(languageVocabItems.orderIndex));

  if (vocab.length === 0) {
    return c.json(
      {
        error: "content_missing",
        message: "Lesson content is not ready yet",
      },
      409
    );
  }

  if (vocab.length < 5) {
    return c.json(
      {
        error: "content_missing",
        message: "Lesson vocabulary is incomplete",
      },
      409
    );
  }

  try {
    await ensureLessonExercises(lesson.lessonId);
  } catch {
    return c.json(
      {
        error: "content_missing",
        message: "Lesson exercises are not ready yet",
      },
      409
    );
  }

  const exercises = await db
    .select({
      id: languageExercises.id,
      type: languageExercises.type,
      orderIndex: languageExercises.orderIndex,
      prompt: languageExercises.prompt,
    })
    .from(languageExercises)
    .where(eq(languageExercises.lessonId, lesson.lessonId))
    .orderBy(asc(languageExercises.orderIndex));

  const exerciseIds = exercises.map((ex) => ex.id);
  const optionRows = exerciseIds.length
    ? await db
        .select({
          optionId: languageExerciseOptions.id,
          exerciseId: languageExerciseOptions.exerciseId,
          orderIndex: languageExerciseOptions.orderIndex,
          text: languageVocabItems.translation,
        })
        .from(languageExerciseOptions)
        .innerJoin(
          languageVocabItems,
          eq(languageVocabItems.id, languageExerciseOptions.vocabItemId)
        )
        .where(inArray(languageExerciseOptions.exerciseId, exerciseIds))
        .orderBy(asc(languageExerciseOptions.exerciseId), asc(languageExerciseOptions.orderIndex))
    : [];

  const optionMap = new Map<
    string,
    Array<{ id: string; text: string; orderIndex: number }>
  >();

  for (const row of optionRows) {
    const existing = optionMap.get(row.exerciseId) || [];
    existing.push({ id: row.optionId, text: row.text, orderIndex: row.orderIndex });
    optionMap.set(row.exerciseId, existing);
  }

  const totalAttemptRows = await db
    .select({ total: count(languageAttempts.id) })
    .from(languageAttempts)
    .where(and(eq(languageAttempts.userId, userId), eq(languageAttempts.lessonId, lesson.lessonId)));

  const totalAttempts = Number(totalAttemptRows[0]?.total || 0);
  const attemptNumber = totalAttempts + 1;
  const startedAt = new Date();

  const [attempt] = await db
    .insert(languageAttempts)
    .values({
      userId,
      lessonId: lesson.lessonId,
      attemptNumber,
      status: "in_progress",
      startedAt,
    })
    .returning({
      id: languageAttempts.id,
      status: languageAttempts.status,
      attemptNumber: languageAttempts.attemptNumber,
      startedAt: languageAttempts.startedAt,
    });

  if (!attempt) {
    return c.json(
      { error: "internal_server_error", message: "Failed to create attempt" },
      500
    );
  }

  return c.json(
    {
      attempt: {
        id: attempt.id,
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt.toISOString(),
      },
      course: {
        id: lesson.courseId,
        title: lesson.courseTitle,
        targetLanguageCode: lesson.targetLanguageCode,
        level: lesson.level,
      },
      lesson: {
        id: lesson.lessonId,
        title: lesson.lessonTitle,
        objective: lesson.lessonObjective,
        status: lesson.lessonStatus,
        orderIndex: lesson.lessonOrder,
      },
      vocab: vocab.map((row) => ({
        ...row,
      })),
      exercises: exercises.map((ex) => ({
        id: ex.id,
        type: ex.type,
        orderIndex: ex.orderIndex,
        prompt: ex.prompt,
        options: optionMap.get(ex.id) || [],
      })),
    },
    201
  );
});

// ─── Submit an attempt (grade server-side) ──────────────────────────────────

languageRouter.post(
  "/attempts/:attemptId/submit",
  zValidator("json", submitAttemptSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const attemptId = c.req.param("attemptId");
    const { answers } = c.req.valid("json");

    const [attempt] = await db
      .select({
        attemptId: languageAttempts.id,
        status: languageAttempts.status,
        attemptNumber: languageAttempts.attemptNumber,
        startedAt: languageAttempts.startedAt,
        lessonId: languageAttempts.lessonId,
        lessonOrder: languageLessons.orderIndex,
        courseId: languageLessons.courseId,
      })
      .from(languageAttempts)
      .innerJoin(languageLessons, eq(languageLessons.id, languageAttempts.lessonId))
      .innerJoin(languageCourses, eq(languageCourses.id, languageLessons.courseId))
      .where(and(eq(languageAttempts.id, attemptId), eq(languageCourses.userId, userId)))
      .limit(1);

    if (!attempt) {
      return c.json({ error: "not_found", message: "Attempt not found" }, 404);
    }

    if (attempt.status === "submitted") {
      return c.json(
        { error: "conflict", message: "This attempt has already been submitted" },
        409
      );
    }

    const exerciseRows = await db
      .select({
        exerciseId: languageExercises.id,
        type: languageExercises.type,
        vocabItemId: languageExercises.vocabItemId,
        expectedTerm: languageVocabItems.term,
      })
      .from(languageExercises)
      .innerJoin(languageVocabItems, eq(languageVocabItems.id, languageExercises.vocabItemId))
      .where(eq(languageExercises.lessonId, attempt.lessonId))
      .orderBy(asc(languageExercises.orderIndex));

    if (exerciseRows.length === 0) {
      return c.json(
        { error: "not_found", message: "No exercises found for this lesson" },
        404
      );
    }

    const exerciseIds = exerciseRows.map((row) => row.exerciseId);

    const optionRows = await db
      .select({
        optionId: languageExerciseOptions.id,
        exerciseId: languageExerciseOptions.exerciseId,
        vocabItemId: languageExerciseOptions.vocabItemId,
      })
      .from(languageExerciseOptions)
      .where(inArray(languageExerciseOptions.exerciseId, exerciseIds));

    const optionsByExercise = new Map<string, Map<string, string>>();
    for (const row of optionRows) {
      const current = optionsByExercise.get(row.exerciseId) || new Map<string, string>();
      current.set(row.optionId, row.vocabItemId);
      optionsByExercise.set(row.exerciseId, current);
    }

    const answerMap = new Map<string, { selectedOptionId: string | null; typedText: string | null }>();
    for (const ans of answers) {
      answerMap.set(ans.exerciseId, {
        selectedOptionId: ans.selectedOptionId ?? null,
        typedText: ans.typedText ?? null,
      });
    }

    const inserts: Array<{
      attemptId: string;
      exerciseId: string;
      selectedOptionId: string | null;
      typedText: string | null;
      isCorrect: boolean;
    }> = [];

    let correctAnswers = 0;

    for (const ex of exerciseRows) {
      const submitted = answerMap.get(ex.exerciseId) || {
        selectedOptionId: null,
        typedText: null,
      };

      let isCorrect = false;

      if (ex.type === "typing") {
        const expected = normalizeForCompare(ex.expectedTerm);
        const typed = normalizeForCompare(submitted.typedText || "");
        isCorrect = Boolean(typed) && typed === expected;
      } else if (ex.type === "mcq" || ex.type === "listening") {
        const selectedOptionId = submitted.selectedOptionId;
        const optionMapForEx = optionsByExercise.get(ex.exerciseId);

        if (selectedOptionId && optionMapForEx?.has(selectedOptionId)) {
          const selectedVocabId = optionMapForEx.get(selectedOptionId);
          isCorrect = selectedVocabId === ex.vocabItemId;
        } else {
          isCorrect = false;
        }
      }

      if (isCorrect) {
        correctAnswers += 1;
      }

      inserts.push({
        attemptId,
        exerciseId: ex.exerciseId,
        selectedOptionId: submitted.selectedOptionId,
        typedText: submitted.typedText ? submitted.typedText.trim() : null,
        isCorrect,
      });
    }

    await db.insert(languageAttemptAnswers).values(inserts);

    const totalQuestions = exerciseRows.length;
    const scorePercent = Math.round((correctAnswers / totalQuestions) * 100);
    const submittedAt = new Date();
    const durationSec = Math.max(1, Math.round((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000));

    await db
      .update(languageAttempts)
      .set({
        status: "submitted",
        submittedAt,
        totalQuestions,
        correctAnswers,
        scorePercent,
        durationSec,
      })
      .where(eq(languageAttempts.id, attemptId));

    // Mark lesson completed and unlock next lesson.
    await db
      .update(languageLessons)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(languageLessons.id, attempt.lessonId));

    const [nextLesson] = await db
      .select({ id: languageLessons.id, status: languageLessons.status })
      .from(languageLessons)
      .where(
        and(
          eq(languageLessons.courseId, attempt.courseId),
          gt(languageLessons.orderIndex, attempt.lessonOrder)
        )
      )
      .orderBy(asc(languageLessons.orderIndex))
      .limit(1);

    if (nextLesson && nextLesson.status === "locked") {
      await db
        .update(languageLessons)
        .set({ status: "available", updatedAt: new Date() })
        .where(eq(languageLessons.id, nextLesson.id));
    }

    return c.json({
      attemptId,
      scorePercent,
      correctAnswers,
      totalQuestions,
      durationSec,
    });
  }
);

// ─── Attempt logs ──────────────────────────────────────────────────────────

languageRouter.get("/attempts", async (c) => {
  const userId = c.get("userId") as string;
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: languageAttempts.id,
      lessonId: languageAttempts.lessonId,
      attemptNumber: languageAttempts.attemptNumber,
      status: languageAttempts.status,
      scorePercent: languageAttempts.scorePercent,
      totalQuestions: languageAttempts.totalQuestions,
      correctAnswers: languageAttempts.correctAnswers,
      durationSec: languageAttempts.durationSec,
      startedAt: languageAttempts.startedAt,
      submittedAt: languageAttempts.submittedAt,
      createdAt: languageAttempts.createdAt,
      lessonTitle: languageLessons.title,
      courseTitle: languageCourses.title,
      targetLanguageCode: languageCourses.targetLanguageCode,
      level: languageCourses.level,
    })
    .from(languageAttempts)
    .innerJoin(languageLessons, eq(languageLessons.id, languageAttempts.lessonId))
    .innerJoin(languageCourses, eq(languageCourses.id, languageLessons.courseId))
    .where(eq(languageCourses.userId, userId))
    .orderBy(desc(languageAttempts.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    attempts: rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      submittedAt: toIso(row.submittedAt),
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    limit,
  });
});

// ─── Attempt result ────────────────────────────────────────────────────────

languageRouter.get("/attempts/:attemptId/result", async (c) => {
  const userId = c.get("userId") as string;
  const attemptId = c.req.param("attemptId");

  const [attempt] = await db
    .select({
      attemptId: languageAttempts.id,
      status: languageAttempts.status,
      attemptNumber: languageAttempts.attemptNumber,
      startedAt: languageAttempts.startedAt,
      submittedAt: languageAttempts.submittedAt,
      scorePercent: languageAttempts.scorePercent,
      totalQuestions: languageAttempts.totalQuestions,
      correctAnswers: languageAttempts.correctAnswers,
      durationSec: languageAttempts.durationSec,
      lessonId: languageLessons.id,
      lessonTitle: languageLessons.title,
      lessonObjective: languageLessons.objective,
      lessonOrder: languageLessons.orderIndex,
      courseId: languageCourses.id,
      courseTitle: languageCourses.title,
      targetLanguageCode: languageCourses.targetLanguageCode,
      level: languageCourses.level,
    })
    .from(languageAttempts)
    .innerJoin(languageLessons, eq(languageLessons.id, languageAttempts.lessonId))
    .innerJoin(languageCourses, eq(languageCourses.id, languageLessons.courseId))
    .where(and(eq(languageAttempts.id, attemptId), eq(languageCourses.userId, userId)))
    .limit(1);

  if (!attempt) {
    return c.json({ error: "not_found", message: "Attempt not found" }, 404);
  }

  if (attempt.status !== "submitted") {
    return c.json(
      { error: "forbidden", message: "Result is available only after submission" },
      403
    );
  }

  const answerRows = await db
    .select({
      exerciseId: languageAttemptAnswers.exerciseId,
      selectedOptionId: languageAttemptAnswers.selectedOptionId,
      typedText: languageAttemptAnswers.typedText,
      isCorrect: languageAttemptAnswers.isCorrect,
    })
    .from(languageAttemptAnswers)
    .where(eq(languageAttemptAnswers.attemptId, attemptId));

  const answersByExercise = new Map<
    string,
    { selectedOptionId: string | null; typedText: string | null; isCorrect: boolean }
  >();

  for (const row of answerRows) {
    answersByExercise.set(row.exerciseId, {
      selectedOptionId: row.selectedOptionId,
      typedText: row.typedText,
      isCorrect: row.isCorrect,
    });
  }

  const exercises = await db
    .select({
      exerciseId: languageExercises.id,
      type: languageExercises.type,
      orderIndex: languageExercises.orderIndex,
      prompt: languageExercises.prompt,
      vocabItemId: languageExercises.vocabItemId,
      correctTerm: languageVocabItems.term,
      correctTranslation: languageVocabItems.translation,
    })
    .from(languageExercises)
    .innerJoin(languageVocabItems, eq(languageVocabItems.id, languageExercises.vocabItemId))
    .where(eq(languageExercises.lessonId, attempt.lessonId))
    .orderBy(asc(languageExercises.orderIndex));

  const exerciseIds = exercises.map((ex) => ex.exerciseId);
  const optionRows = exerciseIds.length
    ? await db
        .select({
          optionId: languageExerciseOptions.id,
          exerciseId: languageExerciseOptions.exerciseId,
          orderIndex: languageExerciseOptions.orderIndex,
          vocabItemId: languageExerciseOptions.vocabItemId,
          text: languageVocabItems.translation,
        })
        .from(languageExerciseOptions)
        .innerJoin(
          languageVocabItems,
          eq(languageVocabItems.id, languageExerciseOptions.vocabItemId)
        )
        .where(inArray(languageExerciseOptions.exerciseId, exerciseIds))
        .orderBy(asc(languageExerciseOptions.exerciseId), asc(languageExerciseOptions.orderIndex))
    : [];

  const optionsByExercise = new Map<
    string,
    Array<{ id: string; text: string; isCorrect: boolean; orderIndex: number }>
  >();

  for (const row of optionRows) {
    const existing = optionsByExercise.get(row.exerciseId) || [];
    const correctVocabId = exercises.find((ex) => ex.exerciseId === row.exerciseId)?.vocabItemId;
    existing.push({
      id: row.optionId,
      text: row.text,
      isCorrect: Boolean(correctVocabId && row.vocabItemId === correctVocabId),
      orderIndex: row.orderIndex,
    });
    optionsByExercise.set(row.exerciseId, existing);
  }

  const resultExercises = exercises.map((ex) => {
    const answer = answersByExercise.get(ex.exerciseId) || {
      selectedOptionId: null,
      typedText: null,
      isCorrect: false,
    };

    const options = optionsByExercise.get(ex.exerciseId) || [];
    const correctOptionId = options.find((opt) => opt.isCorrect)?.id || null;

    return {
      id: ex.exerciseId,
      type: ex.type,
      orderIndex: ex.orderIndex,
      prompt: ex.prompt,
      selectedOptionId: answer.selectedOptionId,
      typedText: answer.typedText,
      isCorrect: answer.isCorrect,
      correctOptionId,
      correctTerm: ex.correctTerm,
      correctTranslation: ex.correctTranslation,
      options,
    };
  });

  return c.json({
    attempt: {
      id: attempt.attemptId,
      status: attempt.status,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
      scorePercent: attempt.scorePercent,
      correctAnswers: attempt.correctAnswers,
      totalQuestions: attempt.totalQuestions,
      durationSec: attempt.durationSec,
    },
    course: {
      id: attempt.courseId,
      title: attempt.courseTitle,
      targetLanguageCode: attempt.targetLanguageCode,
      level: attempt.level,
    },
    lesson: {
      id: attempt.lessonId,
      title: attempt.lessonTitle,
      objective: attempt.lessonObjective,
      orderIndex: attempt.lessonOrder,
    },
    exercises: resultExercises,
  });
});

export default languageRouter;
