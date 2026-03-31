import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../db";
import {
  aiGenerationUsage,
  difficultyLevels,
  unseenAttemptAnswers,
  unseenAttempts,
  unseenPassages,
  unseenQuestionOptions,
  unseenQuestions,
} from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import {
  generateUnseenWithOpenRouter,
  OpenRouterGenerationError,
} from "../services/openrouter";
import {
  HARD_CODED_UNSEEN_PASSAGES,
  type HardcodedUnseenPassage,
} from "../utils/hardcodedUnseen";

const unseenRouter = new Hono();

unseenRouter.use("/*", authMiddleware);

const difficultySeed = [
  {
    key: "easy",
    label: "Easy",
    sortOrder: 1,
    defaultTimeLimitSec: 150,
  },
  {
    key: "medium",
    label: "Medium",
    sortOrder: 2,
    defaultTimeLimitSec: 180,
  },
  {
    key: "hard",
    label: "Hard",
    sortOrder: 3,
    defaultTimeLimitSec: 240,
  },
] as const;

const generateSchema = z.object({
  theme: z.string().trim().min(2).max(200),
  keywords: z.string().trim().max(500).optional(),
  difficultyKey: z.string().trim().min(2).max(50).default("medium"),
  timeLimitSec: z.number().int().min(30).max(1800).optional(),
  publish: z.boolean().optional().default(false),
});

const submitAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        selectedOptionId: z.string().uuid().nullable().optional(),
      })
    )
    .min(1)
    .superRefine((answers, ctx) => {
      const seen = new Set<string>();
      for (const answer of answers) {
        if (seen.has(answer.questionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate questionId found in answers",
          });
          return;
        }
        seen.add(answer.questionId);
      }
    }),
});

function makeTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isDebugOpenRouterEnabled(): boolean {
  const raw = (
    process.env.DEBUG_OPENROUTER ||
    process.env.OPENROUTER_DEBUG ||
    ""
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function countWords(input: string): number {
  return input
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0).length;
}

async function ensureDifficultyLevels() {
  await db
    .insert(difficultyLevels)
    .values(
      difficultySeed.map((row) => ({
        key: row.key,
        label: row.label,
        sortOrder: row.sortOrder,
        defaultTimeLimitSec: row.defaultTimeLimitSec,
        isActive: true,
      }))
    )
    .onConflictDoNothing({ target: difficultyLevels.key });
}

async function insertHardcodedPassage(passage: HardcodedUnseenPassage) {
  const [existing] = await db
    .select({ id: unseenPassages.id })
    .from(unseenPassages)
    .where(
      and(
        eq(unseenPassages.title, passage.title),
        eq(unseenPassages.sourceType, "hardcoded")
      )
    )
    .limit(1);

  if (existing) {
    return;
  }

  const sanitizedContent = sanitizeText(passage.content);
  const [createdPassage] = await db
    .insert(unseenPassages)
    .values({
      title: sanitizeText(passage.title),
      content: sanitizedContent,
      wordCount: countWords(sanitizedContent),
      theme: sanitizeText(passage.theme),
      keywords: null,
      difficultyKey: passage.difficultyKey,
      timeLimitSec: passage.timeLimitSec,
      isPublished: true,
      sourceType: "hardcoded",
      createdBy: null,
    })
    .returning({ id: unseenPassages.id });

  if (!createdPassage) {
    throw new Error("Failed to create hardcoded unseen passage");
  }

  for (const [qIndex, question] of passage.questions.entries()) {
    const [createdQuestion] = await db
      .insert(unseenQuestions)
      .values({
        unseenPassageId: createdPassage.id,
        prompt: sanitizeText(question.prompt),
        explanation: question.explanation ? sanitizeText(question.explanation) : null,
        orderIndex: qIndex + 1,
      })
      .returning({ id: unseenQuestions.id });

    if (!createdQuestion) {
      throw new Error("Failed to create hardcoded unseen question");
    }

    await db.insert(unseenQuestionOptions).values(
      question.options.map((option, optionIndex) => ({
        questionId: createdQuestion.id,
        text: sanitizeText(option.text),
        isCorrect: option.isCorrect,
        orderIndex: optionIndex + 1,
      }))
    );
  }
}

async function ensureHardcodedUnseenPassages() {
  await ensureDifficultyLevels();

  for (const passage of HARD_CODED_UNSEEN_PASSAGES) {
    await insertHardcodedPassage(passage);
  }
}

async function fetchAccessiblePassage(userId: string, passageId: string) {
  const [row] = await db
    .select({
      id: unseenPassages.id,
      title: unseenPassages.title,
      content: unseenPassages.content,
      wordCount: unseenPassages.wordCount,
      theme: unseenPassages.theme,
      difficultyKey: unseenPassages.difficultyKey,
      timeLimitSec: unseenPassages.timeLimitSec,
      isPublished: unseenPassages.isPublished,
      sourceType: unseenPassages.sourceType,
      createdBy: unseenPassages.createdBy,
      createdAt: unseenPassages.createdAt,
      updatedAt: unseenPassages.updatedAt,
    })
    .from(unseenPassages)
    .where(
      and(
        eq(unseenPassages.id, passageId),
        or(
          eq(unseenPassages.isPublished, true),
          eq(unseenPassages.createdBy, userId)
        )
      )
    )
    .limit(1);

  return row;
}

async function getAttemptWithPassage(userId: string, attemptId: string) {
  const [attempt] = await db
    .select({
      attemptId: unseenAttempts.id,
      userId: unseenAttempts.userId,
      unseenPassageId: unseenAttempts.unseenPassageId,
      attemptNumber: unseenAttempts.attemptNumber,
      status: unseenAttempts.status,
      startedAt: unseenAttempts.startedAt,
      passageExpiresAt: unseenAttempts.passageExpiresAt,
      submittedAt: unseenAttempts.submittedAt,
      scorePercent: unseenAttempts.scorePercent,
      totalQuestions: unseenAttempts.totalQuestions,
      correctAnswers: unseenAttempts.correctAnswers,
      durationSec: unseenAttempts.durationSec,
      title: unseenPassages.title,
      content: unseenPassages.content,
      wordCount: unseenPassages.wordCount,
      theme: unseenPassages.theme,
      difficultyKey: unseenPassages.difficultyKey,
      timeLimitSec: unseenPassages.timeLimitSec,
      sourceType: unseenPassages.sourceType,
    })
    .from(unseenAttempts)
    .innerJoin(unseenPassages, eq(unseenPassages.id, unseenAttempts.unseenPassageId))
    .where(and(eq(unseenAttempts.id, attemptId), eq(unseenAttempts.userId, userId)))
    .limit(1);

  return attempt;
}

async function getFallbackPassage(userId: string) {
  await ensureHardcodedUnseenPassages();

  let [fallback] = await db
    .select({
      id: unseenPassages.id,
      title: unseenPassages.title,
      theme: unseenPassages.theme,
      difficultyKey: unseenPassages.difficultyKey,
      timeLimitSec: unseenPassages.timeLimitSec,
      sourceType: unseenPassages.sourceType,
      isPublished: unseenPassages.isPublished,
      createdAt: unseenPassages.createdAt,
    })
    .from(unseenPassages)
    .where(
      and(
        eq(unseenPassages.isPublished, true),
        inArray(unseenPassages.sourceType, ["hardcoded", "manual"])
      )
    )
    .orderBy(sql`random()`)
    .limit(1);

  if (!fallback) {
    [fallback] = await db
      .select({
        id: unseenPassages.id,
        title: unseenPassages.title,
        theme: unseenPassages.theme,
        difficultyKey: unseenPassages.difficultyKey,
        timeLimitSec: unseenPassages.timeLimitSec,
        sourceType: unseenPassages.sourceType,
        isPublished: unseenPassages.isPublished,
        createdAt: unseenPassages.createdAt,
      })
      .from(unseenPassages)
      .where(
        or(
          eq(unseenPassages.isPublished, true),
          eq(unseenPassages.createdBy, userId)
        )
      )
      .orderBy(sql`random()`)
      .limit(1);
  }

  return fallback;
}

// ─── List available unseen passages ────────────────────────────────────────

unseenRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;
  await ensureHardcodedUnseenPassages();

  const rows = await db
    .select({
      id: unseenPassages.id,
      title: unseenPassages.title,
      theme: unseenPassages.theme,
      wordCount: unseenPassages.wordCount,
      difficultyKey: unseenPassages.difficultyKey,
      timeLimitSec: unseenPassages.timeLimitSec,
      sourceType: unseenPassages.sourceType,
      isPublished: unseenPassages.isPublished,
      createdBy: unseenPassages.createdBy,
      createdAt: unseenPassages.createdAt,
      updatedAt: unseenPassages.updatedAt,
    })
    .from(unseenPassages)
    .where(
      or(eq(unseenPassages.isPublished, true), eq(unseenPassages.createdBy, userId))
    )
    .orderBy(desc(unseenPassages.createdAt));

  return c.json({
    passages: rows.map((row) => ({
      ...row,
      isOwnedByUser: row.createdBy === userId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
});

// ─── Generate unseen with OpenRouter ───────────────────────────────────────

unseenRouter.post("/generate", zValidator("json", generateSchema), async (c) => {
  const userId = c.get("userId") as string;
  const isAdmin = Boolean(c.get("isAdmin"));
  const body = c.req.valid("json");

  const traceId = makeTraceId();
  const startedAt = Date.now();
  const debug = isDebugOpenRouterEnabled();

  console.log(`[unseen.generate:${traceId}] start`, {
    userId,
    theme: body.theme,
    keywordsLength: body.keywords?.trim()?.length ?? 0,
    difficultyKey: body.difficultyKey,
    timeLimitSec: body.timeLimitSec ?? null,
    publishRequested: Boolean(body.publish),
    publishEffective: isAdmin ? Boolean(body.publish) : false,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    openRouterModelEnv: process.env.OPENROUTER_MODEL ?? null,
    openRouterModelsEnv: process.env.OPENROUTER_MODELS ?? null,
  });

  await ensureHardcodedUnseenPassages();

  const [difficulty] = await db
    .select({
      key: difficultyLevels.key,
      defaultTimeLimitSec: difficultyLevels.defaultTimeLimitSec,
      isActive: difficultyLevels.isActive,
    })
    .from(difficultyLevels)
    .where(eq(difficultyLevels.key, body.difficultyKey))
    .limit(1);

  if (!difficulty || !difficulty.isActive) {
    return c.json(
      {
        error: "validation_error",
        message: "Invalid or inactive difficulty level",
      },
      400
    );
  }

  const timeLimitSec = body.timeLimitSec ?? difficulty.defaultTimeLimitSec;

  try {
    const generated = await generateUnseenWithOpenRouter({
      theme: body.theme,
      keywords: body.keywords,
      traceId,
    });

    const sanitizedContent = sanitizeText(generated.content);
    const words = countWords(sanitizedContent);

    const [createdPassage] = await db
      .insert(unseenPassages)
      .values({
        title: sanitizeText(generated.title),
        content: sanitizedContent,
        wordCount: words,
        theme: sanitizeText(body.theme),
        keywords: body.keywords?.trim() || null,
        difficultyKey: difficulty.key,
        timeLimitSec,
        isPublished: isAdmin ? body.publish : false,
        sourceType: "ai",
        createdBy: userId,
      })
      .returning({ id: unseenPassages.id, createdAt: unseenPassages.createdAt });

    if (!createdPassage) {
      throw new Error("Failed to create AI unseen passage");
    }

    for (const [qIndex, question] of generated.questions.entries()) {
      const [createdQuestion] = await db
        .insert(unseenQuestions)
        .values({
          unseenPassageId: createdPassage.id,
          prompt: sanitizeText(question.prompt),
          explanation: question.explanation ? sanitizeText(question.explanation) : null,
          orderIndex: qIndex + 1,
        })
        .returning({ id: unseenQuestions.id });

      if (!createdQuestion) {
        throw new Error("Failed to create AI unseen question");
      }

      await db.insert(unseenQuestionOptions).values(
        question.options.map((option, optionIndex) => ({
          questionId: createdQuestion.id,
          text: sanitizeText(option.text),
          isCorrect: option.isCorrect,
          orderIndex: optionIndex + 1,
        }))
      );
    }

    await db.insert(aiGenerationUsage).values({
      userId,
      theme: sanitizeText(body.theme),
      keywords: body.keywords?.trim() || null,
      model: generated.model,
      status: "success",
      errorMessage: null,
    });

    console.log(`[unseen.generate:${traceId}] success`, {
      model: generated.model,
      wordCount: words,
      passageId: createdPassage.id,
      durationMs: Date.now() - startedAt,
    });

    return c.json(
      {
        generated: true,
        fallback: false,
        passage: {
          id: createdPassage.id,
          title: sanitizeText(generated.title),
          theme: sanitizeText(body.theme),
          difficultyKey: difficulty.key,
          timeLimitSec,
          sourceType: "ai",
          isPublished: isAdmin ? body.publish : false,
          createdAt: createdPassage.createdAt.toISOString(),
        },
      },
      201
    );
  } catch (error) {
    const attemptedModels =
      error instanceof OpenRouterGenerationError ? error.attemptedModels : [];

    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[unseen.generate:${traceId}] failed`, {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage,
      attemptedModels,
      durationMs: Date.now() - startedAt,
    });

    if (debug && error instanceof Error && error.stack) {
      console.error(`[unseen.generate:${traceId}] stack`, error.stack);
    }

    await db.insert(aiGenerationUsage).values({
      userId,
      theme: sanitizeText(body.theme),
      keywords: body.keywords?.trim() || null,
      model: attemptedModels[0] || "none",
      status: "failed",
      errorMessage,
    });

    const fallback = await getFallbackPassage(userId);

    console.warn(`[unseen.generate:${traceId}] fallback`, {
      fallbackFound: Boolean(fallback),
      fallbackId: fallback?.id ?? null,
      fallbackSourceType: fallback?.sourceType ?? null,
    });

    if (!fallback) {
      return c.json(
        {
          error: "generation_failed",
          message: "AI generation failed and no fallback passage is available",
        },
        503
      );
    }

    return c.json({
      generated: false,
      fallback: true,
      message: "AI generation failed. A fallback unseen passage is ready.",
      passage: {
        ...fallback,
        createdAt: fallback.createdAt.toISOString(),
      },
    });
  }
});

// ─── List unseen attempt logs ──────────────────────────────────────────────

unseenRouter.get("/attempts", async (c) => {
  const userId = c.get("userId") as string;
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: unseenAttempts.id,
      unseenPassageId: unseenAttempts.unseenPassageId,
      title: unseenPassages.title,
      theme: unseenPassages.theme,
      difficultyKey: unseenPassages.difficultyKey,
      sourceType: unseenPassages.sourceType,
      attemptNumber: unseenAttempts.attemptNumber,
      status: unseenAttempts.status,
      scorePercent: unseenAttempts.scorePercent,
      totalQuestions: unseenAttempts.totalQuestions,
      correctAnswers: unseenAttempts.correctAnswers,
      durationSec: unseenAttempts.durationSec,
      startedAt: unseenAttempts.startedAt,
      passageExpiresAt: unseenAttempts.passageExpiresAt,
      submittedAt: unseenAttempts.submittedAt,
      createdAt: unseenAttempts.createdAt,
    })
    .from(unseenAttempts)
    .innerJoin(unseenPassages, eq(unseenPassages.id, unseenAttempts.unseenPassageId))
    .where(eq(unseenAttempts.userId, userId))
    .orderBy(desc(unseenAttempts.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    attempts: rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      passageExpiresAt: row.passageExpiresAt.toISOString(),
      submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    limit,
  });
});

// ─── Start an unseen attempt ────────────────────────────────────────────────

unseenRouter.post("/:id/start", async (c) => {
  const userId = c.get("userId") as string;
  const passageId = c.req.param("id");

  const passage = await fetchAccessiblePassage(userId, passageId);

  if (!passage) {
    return c.json(
      { error: "not_found", message: "Unseen passage not found" },
      404
    );
  }

  const totalRows = await db
    .select({ total: count(unseenAttempts.id) })
    .from(unseenAttempts)
    .where(
      and(
        eq(unseenAttempts.userId, userId),
        eq(unseenAttempts.unseenPassageId, passage.id)
      )
    );

  const total = Number(totalRows[0]?.total || 0);
  const attemptNumber = Number(total || 0) + 1;
  const startedAt = new Date();
  const passageExpiresAt = new Date(startedAt.getTime() + passage.timeLimitSec * 1000);

  const [attempt] = await db
    .insert(unseenAttempts)
    .values({
      userId,
      unseenPassageId: passage.id,
      attemptNumber,
      isRetry: attemptNumber > 1,
      status: "in_progress",
      startedAt,
      passageExpiresAt,
    })
    .returning({
      id: unseenAttempts.id,
      status: unseenAttempts.status,
      startedAt: unseenAttempts.startedAt,
      passageExpiresAt: unseenAttempts.passageExpiresAt,
      attemptNumber: unseenAttempts.attemptNumber,
      isRetry: unseenAttempts.isRetry,
    });

  if (!attempt) {
    return c.json(
      {
        error: "internal_server_error",
        message: "Failed to create unseen attempt",
      },
      500
    );
  }

  return c.json(
    {
      attempt: {
        ...attempt,
        startedAt: attempt.startedAt.toISOString(),
        passageExpiresAt: attempt.passageExpiresAt.toISOString(),
      },
      passage: {
        id: passage.id,
        title: passage.title,
        content: passage.content,
        theme: passage.theme,
        wordCount: passage.wordCount,
        difficultyKey: passage.difficultyKey,
        timeLimitSec: passage.timeLimitSec,
        sourceType: passage.sourceType,
      },
    },
    201
  );
});

// ─── Attempt stage and timed passage state ─────────────────────────────────

unseenRouter.get("/attempts/:attemptId", async (c) => {
  const userId = c.get("userId") as string;
  const attemptId = c.req.param("attemptId");

  const attempt = await getAttemptWithPassage(userId, attemptId);

  if (!attempt) {
    return c.json(
      { error: "not_found", message: "Attempt not found" },
      404
    );
  }

  const now = Date.now();
  const expiresAt = attempt.passageExpiresAt.getTime();
  const expired = now >= expiresAt;

  const stage =
    attempt.status === "submitted"
      ? "result"
      : expired
      ? "questions"
      : "reading";

  const remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  return c.json({
    stage,
    remainingSec,
    attempt: {
      id: attempt.attemptId,
      status: attempt.status,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt.toISOString(),
      passageExpiresAt: attempt.passageExpiresAt.toISOString(),
      submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
      scorePercent: attempt.scorePercent,
      totalQuestions: attempt.totalQuestions,
      correctAnswers: attempt.correctAnswers,
      durationSec: attempt.durationSec,
    },
    passage:
      stage === "reading"
        ? {
            id: attempt.unseenPassageId,
            title: attempt.title,
            content: attempt.content,
            wordCount: attempt.wordCount,
            theme: attempt.theme,
            difficultyKey: attempt.difficultyKey,
            timeLimitSec: attempt.timeLimitSec,
            sourceType: attempt.sourceType,
          }
        : null,
  });
});

// ─── Get MCQs (only after timer ends) ─────────────────────────────────────

unseenRouter.get("/attempts/:attemptId/questions", async (c) => {
  const userId = c.get("userId") as string;
  const attemptId = c.req.param("attemptId");

  const attempt = await getAttemptWithPassage(userId, attemptId);

  if (!attempt) {
    return c.json(
      { error: "not_found", message: "Attempt not found" },
      404
    );
  }

  const now = Date.now();
  if (attempt.status !== "submitted" && now < attempt.passageExpiresAt.getTime()) {
    return c.json(
      {
        error: "forbidden",
        message: "Questions are available only after reading time ends",
      },
      403
    );
  }

  const rows = await db
    .select({
      questionId: unseenQuestions.id,
      prompt: unseenQuestions.prompt,
      explanation: unseenQuestions.explanation,
      questionOrder: unseenQuestions.orderIndex,
      optionId: unseenQuestionOptions.id,
      optionText: unseenQuestionOptions.text,
      optionOrder: unseenQuestionOptions.orderIndex,
    })
    .from(unseenQuestions)
    .innerJoin(unseenQuestionOptions, eq(unseenQuestionOptions.questionId, unseenQuestions.id))
    .where(eq(unseenQuestions.unseenPassageId, attempt.unseenPassageId))
    .orderBy(asc(unseenQuestions.orderIndex), asc(unseenQuestionOptions.orderIndex));

  const grouped = new Map<
    string,
    {
      id: string;
      prompt: string;
      explanation: string | null;
      orderIndex: number;
      options: Array<{ id: string; text: string; orderIndex: number }>;
    }
  >();

  for (const row of rows) {
    const existing = grouped.get(row.questionId);
    if (existing) {
      existing.options.push({
        id: row.optionId,
        text: row.optionText,
        orderIndex: row.optionOrder,
      });
      continue;
    }

    grouped.set(row.questionId, {
      id: row.questionId,
      prompt: row.prompt,
      explanation: row.explanation,
      orderIndex: row.questionOrder,
      options: [
        {
          id: row.optionId,
          text: row.optionText,
          orderIndex: row.optionOrder,
        },
      ],
    });
  }

  return c.json({
    attemptId,
    isSubmitted: attempt.status === "submitted",
    questions: Array.from(grouped.values()),
  });
});

// ─── Submit MCQ answers ────────────────────────────────────────────────────

unseenRouter.post(
  "/attempts/:attemptId/submit",
  zValidator("json", submitAnswersSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const attemptId = c.req.param("attemptId");
    const { answers } = c.req.valid("json");

    const attempt = await getAttemptWithPassage(userId, attemptId);

    if (!attempt) {
      return c.json(
        { error: "not_found", message: "Attempt not found" },
        404
      );
    }

    if (attempt.status === "submitted") {
      return c.json(
        {
          error: "conflict",
          message: "This attempt has already been submitted",
        },
        409
      );
    }

    if (Date.now() < attempt.passageExpiresAt.getTime()) {
      return c.json(
        {
          error: "forbidden",
          message: "You can submit answers only after reading time ends",
        },
        403
      );
    }

    const optionRows = await db
      .select({
        questionId: unseenQuestions.id,
        optionId: unseenQuestionOptions.id,
        isCorrect: unseenQuestionOptions.isCorrect,
      })
      .from(unseenQuestions)
      .innerJoin(unseenQuestionOptions, eq(unseenQuestionOptions.questionId, unseenQuestions.id))
      .where(eq(unseenQuestions.unseenPassageId, attempt.unseenPassageId));

    if (optionRows.length === 0) {
      return c.json(
        {
          error: "not_found",
          message: "No questions found for this passage",
        },
        404
      );
    }

    const answerMap = new Map<string, string | null>();
    for (const answer of answers) {
      answerMap.set(answer.questionId, answer.selectedOptionId ?? null);
    }

    const questionMap = new Map<
      string,
      {
        validOptionIds: Set<string>;
        correctOptionId: string | null;
      }
    >();

    for (const row of optionRows) {
      const current = questionMap.get(row.questionId);
      if (!current) {
        questionMap.set(row.questionId, {
          validOptionIds: new Set([row.optionId]),
          correctOptionId: row.isCorrect ? row.optionId : null,
        });
        continue;
      }

      current.validOptionIds.add(row.optionId);
      if (row.isCorrect) {
        current.correctOptionId = row.optionId;
      }
    }

    const inserts: Array<{
      attemptId: string;
      questionId: string;
      selectedOptionId: string | null;
      isCorrect: boolean;
    }> = [];

    let correctAnswers = 0;

    for (const [questionId, metadata] of questionMap.entries()) {
      if (!metadata.correctOptionId) {
        return c.json(
          {
            error: "validation_error",
            message: "Question configuration is invalid",
          },
          500
        );
      }

      const selectedOptionId = answerMap.get(questionId) ?? null;
      if (selectedOptionId && !metadata.validOptionIds.has(selectedOptionId)) {
        return c.json(
          {
            error: "validation_error",
            message: "One or more selected options are invalid",
          },
          400
        );
      }

      const isCorrect = selectedOptionId === metadata.correctOptionId;
      if (isCorrect) {
        correctAnswers += 1;
      }

      inserts.push({
        attemptId,
        questionId,
        selectedOptionId,
        isCorrect,
      });
    }

    await db.insert(unseenAttemptAnswers).values(inserts);

    const totalQuestions = questionMap.size;
    const scorePercent = Math.round((correctAnswers / totalQuestions) * 100);
    const submittedAt = new Date();
    const durationSec = Math.max(
      1,
      Math.round((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000)
    );

    await db
      .update(unseenAttempts)
      .set({
        status: "submitted",
        submittedAt,
        totalQuestions,
        correctAnswers,
        scorePercent,
        durationSec,
      })
      .where(eq(unseenAttempts.id, attemptId));

    return c.json({
      attemptId,
      scorePercent,
      correctAnswers,
      totalQuestions,
      durationSec,
    });
  }
);

// ─── Detailed result after submission ──────────────────────────────────────

unseenRouter.get("/attempts/:attemptId/result", async (c) => {
  const userId = c.get("userId") as string;
  const attemptId = c.req.param("attemptId");

  const attempt = await getAttemptWithPassage(userId, attemptId);

  if (!attempt) {
    return c.json(
      { error: "not_found", message: "Attempt not found" },
      404
    );
  }

  if (attempt.status !== "submitted") {
    return c.json(
      {
        error: "forbidden",
        message: "Result is available only after submission",
      },
      403
    );
  }

  const answerRows = await db
    .select({
      questionId: unseenAttemptAnswers.questionId,
      selectedOptionId: unseenAttemptAnswers.selectedOptionId,
      isCorrect: unseenAttemptAnswers.isCorrect,
    })
    .from(unseenAttemptAnswers)
    .where(eq(unseenAttemptAnswers.attemptId, attemptId));

  const answerMap = new Map<string, { selectedOptionId: string | null; isCorrect: boolean }>();
  for (const answer of answerRows) {
    answerMap.set(answer.questionId, {
      selectedOptionId: answer.selectedOptionId,
      isCorrect: answer.isCorrect,
    });
  }

  const questionRows = await db
    .select({
      questionId: unseenQuestions.id,
      prompt: unseenQuestions.prompt,
      explanation: unseenQuestions.explanation,
      questionOrder: unseenQuestions.orderIndex,
      optionId: unseenQuestionOptions.id,
      optionText: unseenQuestionOptions.text,
      optionOrder: unseenQuestionOptions.orderIndex,
      isCorrect: unseenQuestionOptions.isCorrect,
    })
    .from(unseenQuestions)
    .innerJoin(unseenQuestionOptions, eq(unseenQuestionOptions.questionId, unseenQuestions.id))
    .where(eq(unseenQuestions.unseenPassageId, attempt.unseenPassageId))
    .orderBy(asc(unseenQuestions.orderIndex), asc(unseenQuestionOptions.orderIndex));

  const grouped = new Map<
    string,
    {
      id: string;
      prompt: string;
      explanation: string | null;
      orderIndex: number;
      selectedOptionId: string | null;
      isCorrect: boolean;
      correctOptionId: string | null;
      options: Array<{ id: string; text: string; isCorrect: boolean; orderIndex: number }>;
    }
  >();

  for (const row of questionRows) {
    const existing = grouped.get(row.questionId);
    if (existing) {
      existing.options.push({
        id: row.optionId,
        text: row.optionText,
        isCorrect: row.isCorrect,
        orderIndex: row.optionOrder,
      });
      if (row.isCorrect) {
        existing.correctOptionId = row.optionId;
      }
      continue;
    }

    const answer = answerMap.get(row.questionId);

    grouped.set(row.questionId, {
      id: row.questionId,
      prompt: row.prompt,
      explanation: row.explanation,
      orderIndex: row.questionOrder,
      selectedOptionId: answer?.selectedOptionId ?? null,
      isCorrect: answer?.isCorrect ?? false,
      correctOptionId: row.isCorrect ? row.optionId : null,
      options: [
        {
          id: row.optionId,
          text: row.optionText,
          isCorrect: row.isCorrect,
          orderIndex: row.optionOrder,
        },
      ],
    });
  }

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
    passage: {
      id: attempt.unseenPassageId,
      title: attempt.title,
      theme: attempt.theme,
      difficultyKey: attempt.difficultyKey,
      timeLimitSec: attempt.timeLimitSec,
      sourceType: attempt.sourceType,
    },
    questions: Array.from(grouped.values()),
  });
});

export default unseenRouter;
