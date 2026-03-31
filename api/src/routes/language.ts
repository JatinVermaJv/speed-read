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
  aiGenerationUsage,
  languageAttemptAnswers,
  languageAttempts,
  languageCourses,
  languageExerciseOptions,
  languageExercises,
  languageLessons,
  languageVocabItems,
} from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import {
  generateLanguageCoursePlanWithOpenRouter,
  generateLessonVocabWithOpenRouter,
} from "../services/openrouterLanguage";
import { OpenRouterGenerationError } from "../services/openrouter";

const languageRouter = new Hono();

languageRouter.use("/*", authMiddleware);

const generateCourseSchema = z.object({
  targetLanguageCode: z.string().trim().min(2).max(20),
  level: z.string().trim().min(1).max(20).optional().default("A1"),
  lessonCount: z.number().int().min(3).max(30).optional().default(5),
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

function makeTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

function buildFallbackLessons(lessonCount: number) {
  const base = [
    { title: "Greetings", objective: "Say hello, goodbye, and introduce yourself." },
    { title: "Numbers & Time", objective: "Use numbers and basic time phrases." },
    { title: "Food & Drinks", objective: "Order food and talk about preferences." },
    { title: "Travel Basics", objective: "Ask for directions and handle simple travel needs." },
    { title: "Daily Routine", objective: "Talk about common daily activities." },
    { title: "Shopping", objective: "Ask about prices, sizes, and common items." },
    { title: "Family & Friends", objective: "Describe people and simple relationships." },
    { title: "Weather", objective: "Talk about the weather and seasons." },
  ];

  const safeCount = Math.min(Math.max(3, lessonCount), 30);
  const picked = base.slice(0, Math.min(base.length, safeCount));

  while (picked.length < safeCount) {
    picked.push({
      title: `Lesson ${picked.length + 1}`,
      objective: "Practice common beginner words and phrases.",
    });
  }

  return picked;
}

async function getActiveCourse(userId: string) {
  const [course] = await db
    .select({
      id: languageCourses.id,
      userId: languageCourses.userId,
      targetLanguageCode: languageCourses.targetLanguageCode,
      level: languageCourses.level,
      title: languageCourses.title,
      status: languageCourses.status,
      createdAt: languageCourses.createdAt,
      updatedAt: languageCourses.updatedAt,
    })
    .from(languageCourses)
    .where(and(eq(languageCourses.userId, userId), eq(languageCourses.status, "active")))
    .orderBy(desc(languageCourses.createdAt))
    .limit(1);

  return course || null;
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

async function ensureLessonVocab(params: {
  userId: string;
  targetLanguageCode: string;
  level: string;
  lessonId: string;
  lessonTitle: string;
  lessonObjective: string;
  traceId: string;
}) {
  const existingCountRows = await db
    .select({ total: count(languageVocabItems.id) })
    .from(languageVocabItems)
    .where(eq(languageVocabItems.lessonId, params.lessonId));

  const existingTotal = Number(existingCountRows[0]?.total || 0);
  if (existingTotal > 0) {
    return;
  }

  const startedAt = Date.now();
  try {
    const generated = await generateLessonVocabWithOpenRouter({
      targetLanguageCode: params.targetLanguageCode,
      level: params.level,
      lessonTitle: params.lessonTitle,
      lessonObjective: params.lessonObjective,
      vocabCount: 12,
      traceId: params.traceId,
    });

    await db.insert(languageVocabItems).values(
      generated.vocab.map((item, index) => ({
        lessonId: params.lessonId,
        orderIndex: index + 1,
        term: sanitizeText(item.term),
        translation: sanitizeText(item.translation),
        partOfSpeech: item.partOfSpeech ? sanitizeText(item.partOfSpeech) : null,
        targetExample: item.targetExample ? sanitizeText(item.targetExample) : null,
        nativeExample: item.nativeExample ? sanitizeText(item.nativeExample) : null,
      }))
    );

    await db.insert(aiGenerationUsage).values({
      userId: params.userId,
      feature: "language_vocab",
      theme: "language_vocab",
      keywords: `${params.targetLanguageCode}|${params.level}`,
      model: generated.model,
      status: "success",
      errorMessage: null,
      metadata: JSON.stringify({
        lessonId: params.lessonId,
        lessonTitle: params.lessonTitle,
        vocabCount: 12,
        durationMs: Date.now() - startedAt,
      }),
    });
  } catch (error) {
    const attemptedModels =
      error instanceof OpenRouterGenerationError ? error.attemptedModels : [];
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db.insert(aiGenerationUsage).values({
      userId: params.userId,
      feature: "language_vocab",
      theme: "language_vocab",
      keywords: `${params.targetLanguageCode}|${params.level}`,
      model: attemptedModels[0] || "none",
      status: "failed",
      errorMessage,
      metadata: JSON.stringify({
        lessonId: params.lessonId,
        lessonTitle: params.lessonTitle,
      }),
    });

    throw error;
  }
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

// ─── Get active course + lessons ───────────────────────────────────────────

languageRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const course = await getActiveCourse(userId);
  if (!course) {
    return c.json({ course: null, lessons: [] });
  }

  const lessons = await getLessonsForCourse(course.id);

  return c.json({
    course: {
      ...course,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
    },
    lessons,
  });
});

languageRouter.get("/lessons", async (c) => {
  const userId = c.get("userId") as string;

  const course = await getActiveCourse(userId);
  if (!course) {
    return c.json({ courseId: null, lessons: [] });
  }

  const lessons = await getLessonsForCourse(course.id);
  return c.json({ courseId: course.id, lessons });
});

// ─── Generate course plan with OpenRouter ───────────────────────────────────

languageRouter.post(
  "/course/generate",
  zValidator("json", generateCourseSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const body = c.req.valid("json");

    const traceId = makeTraceId();
    const startedAt = Date.now();

    // Archive any existing active course for the user.
    await db
      .update(languageCourses)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(languageCourses.userId, userId), eq(languageCourses.status, "active")));

    try {
      const generated = await generateLanguageCoursePlanWithOpenRouter({
        targetLanguageCode: body.targetLanguageCode,
        level: body.level,
        lessonCount: body.lessonCount,
        traceId,
      });

      await db.insert(aiGenerationUsage).values({
        userId,
        feature: "language_course_plan",
        theme: "language_course_plan",
        keywords: `${body.targetLanguageCode}|${body.level}|${body.lessonCount}`,
        model: generated.model,
        status: "success",
        errorMessage: null,
        metadata: JSON.stringify({
          lessonCount: body.lessonCount,
          durationMs: Date.now() - startedAt,
        }),
      });

      const courseTitle = sanitizeText(generated.courseTitle);

      const [course] = await db
        .insert(languageCourses)
        .values({
          userId,
          targetLanguageCode: sanitizeText(body.targetLanguageCode),
          level: sanitizeText(body.level),
          title: courseTitle,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({
          id: languageCourses.id,
          createdAt: languageCourses.createdAt,
          updatedAt: languageCourses.updatedAt,
        });

      if (!course) {
        throw new Error("Failed to create course");
      }

      await db.insert(languageLessons).values(
        generated.lessons.map((lesson, index) => ({
          courseId: course.id,
          orderIndex: index + 1,
          title: sanitizeText(lesson.title),
          objective: sanitizeText(lesson.objective),
          status: (index === 0 ? "available" : "locked") as LessonStatus,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );

      const lessons = await getLessonsForCourse(course.id);

      return c.json(
        {
          generated: true,
          fallback: false,
          course: {
            id: course.id,
            userId,
            targetLanguageCode: body.targetLanguageCode,
            level: body.level,
            title: courseTitle,
            status: "active",
            createdAt: course.createdAt.toISOString(),
            updatedAt: course.updatedAt.toISOString(),
          },
          lessons,
        },
        201
      );
    } catch (error) {
      const attemptedModels =
        error instanceof OpenRouterGenerationError ? error.attemptedModels : [];
      const errorMessage = error instanceof Error ? error.message : String(error);

      await db.insert(aiGenerationUsage).values({
        userId,
        feature: "language_course_plan",
        theme: "language_course_plan",
        keywords: `${body.targetLanguageCode}|${body.level}|${body.lessonCount}`,
        model: attemptedModels[0] || "none",
        status: "failed",
        errorMessage,
        metadata: JSON.stringify({ lessonCount: body.lessonCount }),
      });

      const fallbackLessons = buildFallbackLessons(body.lessonCount);
      const fallbackCourseTitle = `${sanitizeText(body.targetLanguageCode)} Basics (${sanitizeText(body.level)})`;

      const [course] = await db
        .insert(languageCourses)
        .values({
          userId,
          targetLanguageCode: sanitizeText(body.targetLanguageCode),
          level: sanitizeText(body.level),
          title: fallbackCourseTitle,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({
          id: languageCourses.id,
          createdAt: languageCourses.createdAt,
          updatedAt: languageCourses.updatedAt,
        });

      if (!course) {
        return c.json(
          {
            error: "generation_failed",
            message: "Course generation failed",
          },
          503
        );
      }

      await db.insert(languageLessons).values(
        fallbackLessons.map((lesson, index) => ({
          courseId: course.id,
          orderIndex: index + 1,
          title: sanitizeText(lesson.title),
          objective: sanitizeText(lesson.objective),
          status: (index === 0 ? "available" : "locked") as LessonStatus,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );

      const lessons = await getLessonsForCourse(course.id);

      return c.json(
        {
          generated: false,
          fallback: true,
          message: "AI generation failed. A fallback course plan is ready.",
          course: {
            id: course.id,
            userId,
            targetLanguageCode: body.targetLanguageCode,
            level: body.level,
            title: fallbackCourseTitle,
            status: "active",
            createdAt: course.createdAt.toISOString(),
            updatedAt: course.updatedAt.toISOString(),
          },
          lessons,
        },
        201
      );
    }
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

  const traceId = makeTraceId();

  try {
    await ensureLessonVocab({
      userId,
      targetLanguageCode: lesson.targetLanguageCode,
      level: lesson.level,
      lessonId: lesson.lessonId,
      lessonTitle: lesson.lessonTitle,
      lessonObjective: lesson.lessonObjective,
      traceId,
    });
  } catch {
    return c.json(
      {
        error: "generation_failed",
        message: "Lesson vocabulary generation failed. Please retry shortly.",
      },
      503
    );
  }

  await ensureLessonExercises(lesson.lessonId);

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
