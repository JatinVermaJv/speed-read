import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, desc, sql, count, sum, avg, max, ne } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  sessions,
  passages,
  refreshTokens,
  difficultyLevels,
  unseenPassages,
  unseenQuestions,
  unseenQuestionOptions,
} from "../db/schema";
import { authMiddleware, adminMiddleware } from "../middleware/auth";

const adminRouter = new Hono();

// All admin routes require authentication + admin role
adminRouter.use("/*", authMiddleware);
adminRouter.use("/*", adminMiddleware);

function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function wordCount(input: string): number {
  return input
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0).length;
}

// ─── Get All Users with Stats ───────────────────────────────────────────────

adminRouter.get("/users", async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = (page - 1) * limit;

  // Get total user count
  const totalRows = await db
    .select({ total: count(users.id) })
    .from(users);

  const total = Number(totalRows[0]?.total) || 0;

  // Get users with aggregated session stats
  const result = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      totalSessions: count(sessions.id),
      totalWordsRead: sum(sessions.totalWordsRead),
      totalTimeSec: sum(sessions.durationSec),
      averageWpm: avg(sessions.endWpm),
      bestWpm: max(sessions.endWpm),
    })
    .from(users)
    .leftJoin(sessions, eq(users.id, sessions.userId))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  const userList = result.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt.toISOString(),
    totalSessions: Number(u.totalSessions) || 0,
    totalWordsRead: Number(u.totalWordsRead) || 0,
    totalTimeSec: Number(u.totalTimeSec) || 0,
    averageWpm: Math.round(Number(u.averageWpm) || 0),
    bestWpm: Number(u.bestWpm) || 0,
  }));

  return c.json({ users: userList, total, page, limit });
});

// ─── Toggle Admin Role ──────────────────────────────────────────────────────

const toggleAdminSchema = z.object({
  isAdmin: z.boolean(),
});

adminRouter.patch(
  "/users/:id/role",
  zValidator("json", toggleAdminSchema),
  async (c) => {
    const targetId = c.req.param("id");
    const currentUserId = c.get("userId") as string;
    const { isAdmin } = c.req.valid("json");

    // Prevent self-demotion
    if (targetId === currentUserId) {
      return c.json(
        { error: "forbidden", message: "You cannot change your own admin role" },
        403
      );
    }

    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);

    if (!target) {
      return c.json({ error: "not_found", message: "User not found" }, 404);
    }

    await db
      .update(users)
      .set({ isAdmin, updatedAt: new Date() })
      .where(eq(users.id, targetId));

    return c.json({ message: `User ${isAdmin ? "promoted to" : "removed from"} admin` });
  }
);

// ─── Delete User ────────────────────────────────────────────────────────────

adminRouter.delete("/users/:id", async (c) => {
  const targetId = c.req.param("id");
  const currentUserId = c.get("userId") as string;

  // Prevent self-deletion
  if (targetId === currentUserId) {
    return c.json(
      { error: "forbidden", message: "You cannot delete your own account" },
      403
    );
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);

  if (!target) {
    return c.json({ error: "not_found", message: "User not found" }, 404);
  }

  // Cascade will handle sessions, refresh tokens, and user-owned passages
  await db.delete(users).where(eq(users.id, targetId));

  return c.json({ message: "User deleted" });
});

// ─── Platform-Wide Stats ────────────────────────────────────────────────────

adminRouter.get("/stats", async (c) => {
  const [userCount] = await db
    .select({ total: count(users.id) })
    .from(users);

  const [sessionStats] = await db
    .select({
      totalSessions: count(sessions.id),
      totalWordsRead: sum(sessions.totalWordsRead),
      totalTimeSec: sum(sessions.durationSec),
      avgWpm: avg(sessions.endWpm),
      bestWpm: max(sessions.endWpm),
    })
    .from(sessions);

  const safeUserCount = userCount || { total: 0 };
  const safeSessionStats =
    sessionStats ||
    ({
      totalSessions: 0,
      totalWordsRead: 0,
      totalTimeSec: 0,
      avgWpm: 0,
      bestWpm: 0,
    } as const);

  return c.json({
    totalUsers: Number(safeUserCount.total) || 0,
    totalSessions: Number(safeSessionStats.totalSessions) || 0,
    totalWordsRead: Number(safeSessionStats.totalWordsRead) || 0,
    totalTimeSec: Number(safeSessionStats.totalTimeSec) || 0,
    platformAvgWpm: Math.round(Number(safeSessionStats.avgWpm) || 0),
    platformBestWpm: Number(safeSessionStats.bestWpm) || 0,
  });
});

// ─── List All Passages (Admin) ──────────────────────────────────────────────

adminRouter.get("/passages", async (c) => {
  const result = await db
    .select({
      id: passages.id,
      title: passages.title,
      content: passages.content,
      wordCount: passages.wordCount,
      category: passages.category,
      isDefault: passages.isDefault,
      userId: passages.userId,
      createdAt: passages.createdAt,
      authorName: users.name,
    })
    .from(passages)
    .leftJoin(users, eq(passages.userId, users.id))
    .orderBy(desc(passages.createdAt));

  return c.json({
    passages: result.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
    })),
  });
});

// ─── Create Passage (Admin — can create default passages) ───────────────────

const createPassageSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  category: z.string().min(1).max(100).default("General"),
  isDefault: z.boolean().default(true),
});

adminRouter.post(
  "/passages",
  zValidator("json", createPassageSchema),
  async (c) => {
    const { title, content, category, isDefault } = c.req.valid("json");

    const sanitizedContent = content.replace(/<[^>]*>/g, "");
    const wordCount = sanitizedContent
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    if (wordCount < 20) {
      return c.json(
        { error: "validation_error", message: "Passage must contain at least 20 words" },
        400
      );
    }

    const [passage] = await db
      .insert(passages)
      .values({
        title: title.replace(/<[^>]*>/g, ""),
        content: sanitizedContent,
        wordCount,
        category,
        isDefault,
        userId: null,
      })
      .returning();

    return c.json({ passage }, 201);
  }
);

// ─── Delete Any Passage (Admin) ─────────────────────────────────────────────

adminRouter.delete("/passages/:id", async (c) => {
  const passageId = c.req.param("id");

  const [passage] = await db
    .select({ id: passages.id })
    .from(passages)
    .where(eq(passages.id, passageId))
    .limit(1);

  if (!passage) {
    return c.json({ error: "not_found", message: "Passage not found" }, 404);
  }

  await db.delete(passages).where(eq(passages.id, passageId));

  return c.json({ message: "Passage deleted" });
});

// ─── Unseen Passage Management (Admin) ─────────────────────────────────────

const unseenOptionSchema = z.object({
  text: z.string().min(1).max(220),
  isCorrect: z.boolean(),
});

const unseenQuestionSchema = z
  .object({
    prompt: z.string().min(8).max(500),
    explanation: z.string().max(1200).optional(),
    options: z.array(unseenOptionSchema).length(4),
  })
  .superRefine((question, ctx) => {
    const correctCount = question.options.filter((option) => option.isCorrect).length;
    if (correctCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each question must have exactly one correct option",
      });
    }
  });

const createUnseenSchema = z.object({
  title: z.string().min(5).max(500),
  content: z.string().min(120),
  theme: z.string().min(1).max(200).default("General"),
  difficultyKey: z.string().min(2).max(50).default("medium"),
  timeLimitSec: z.number().int().min(30).max(1800),
  isPublished: z.boolean().default(true),
  questions: z.array(unseenQuestionSchema).length(5),
});

const publishUnseenSchema = z.object({
  isPublished: z.boolean(),
});

adminRouter.get("/unseen", async (c) => {
  const result = await db
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
      authorName: users.name,
      questionCount: sql<number>`(
        select count(*)::int
        from unseen_questions uq
        where uq.unseen_passage_id = ${unseenPassages.id}
      )`,
    })
    .from(unseenPassages)
    .leftJoin(users, eq(unseenPassages.createdBy, users.id))
    .orderBy(desc(unseenPassages.createdAt));

  return c.json({
    unseenPassages: result.map((row) => ({
      ...row,
      questionCount: Number(row.questionCount) || 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
});

adminRouter.post(
  "/unseen",
  zValidator("json", createUnseenSchema),
  async (c) => {
    const currentUserId = c.get("userId") as string;
    const data = c.req.valid("json");

    const [difficulty] = await db
      .select({ key: difficultyLevels.key, isActive: difficultyLevels.isActive })
      .from(difficultyLevels)
      .where(eq(difficultyLevels.key, data.difficultyKey))
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

    const sanitizedContent = sanitizeText(data.content);
    const totalWords = wordCount(sanitizedContent);

    if (totalWords < 80) {
      return c.json(
        {
          error: "validation_error",
          message: "Unseen passage must contain at least 80 words",
        },
        400
      );
    }

    const [createdPassage] = await db
      .insert(unseenPassages)
      .values({
        title: sanitizeText(data.title),
        content: sanitizedContent,
        wordCount: totalWords,
        theme: sanitizeText(data.theme),
        keywords: null,
        difficultyKey: difficulty.key,
        timeLimitSec: data.timeLimitSec,
        isPublished: data.isPublished,
        sourceType: "manual",
        createdBy: currentUserId,
      })
      .returning({
        id: unseenPassages.id,
        title: unseenPassages.title,
        theme: unseenPassages.theme,
        difficultyKey: unseenPassages.difficultyKey,
        timeLimitSec: unseenPassages.timeLimitSec,
        sourceType: unseenPassages.sourceType,
        isPublished: unseenPassages.isPublished,
        createdAt: unseenPassages.createdAt,
      });

    if (!createdPassage) {
      return c.json(
        {
          error: "internal_server_error",
          message: "Failed to create unseen passage",
        },
        500
      );
    }

    for (const [qIndex, question] of data.questions.entries()) {
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
        return c.json(
          {
            error: "internal_server_error",
            message: "Failed to create unseen question",
          },
          500
        );
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

    return c.json(
      {
        passage: {
          ...createdPassage,
          questionCount: data.questions.length,
          createdAt: createdPassage.createdAt.toISOString(),
        },
      },
      201
    );
  }
);

adminRouter.patch(
  "/unseen/:id/publish",
  zValidator("json", publishUnseenSchema),
  async (c) => {
    const passageId = c.req.param("id");
    const { isPublished } = c.req.valid("json");

    const [existing] = await db
      .select({ id: unseenPassages.id })
      .from(unseenPassages)
      .where(eq(unseenPassages.id, passageId))
      .limit(1);

    if (!existing) {
      return c.json(
        { error: "not_found", message: "Unseen passage not found" },
        404
      );
    }

    await db
      .update(unseenPassages)
      .set({
        isPublished,
        updatedAt: new Date(),
      })
      .where(eq(unseenPassages.id, passageId));

    return c.json({ message: `Unseen passage ${isPublished ? "published" : "hidden"}` });
  }
);

adminRouter.delete("/unseen/:id", async (c) => {
  const passageId = c.req.param("id");

  const [existing] = await db
    .select({ id: unseenPassages.id, sourceType: unseenPassages.sourceType })
    .from(unseenPassages)
    .where(eq(unseenPassages.id, passageId))
    .limit(1);

  if (!existing) {
    return c.json({ error: "not_found", message: "Unseen passage not found" }, 404);
  }

  await db.delete(unseenPassages).where(eq(unseenPassages.id, passageId));

  return c.json({ message: "Unseen passage deleted" });
});

export default adminRouter;
