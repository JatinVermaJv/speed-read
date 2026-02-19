import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, sql, count, sum, avg, max, ne } from "drizzle-orm";
import { db } from "../db";
import { users, sessions, passages, refreshTokens } from "../db/schema";
import { authMiddleware, adminMiddleware } from "../middleware/auth";

const adminRouter = new Hono();

// All admin routes require authentication + admin role
adminRouter.use("/*", authMiddleware);
adminRouter.use("/*", adminMiddleware);

// ─── Get All Users with Stats ───────────────────────────────────────────────

adminRouter.get("/users", async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = (page - 1) * limit;

  // Get total user count
  const [{ total }] = await db
    .select({ total: count(users.id) })
    .from(users);

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

  return c.json({ users: userList, total: Number(total), page, limit });
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

  return c.json({
    totalUsers: Number(userCount.total) || 0,
    totalSessions: Number(sessionStats.totalSessions) || 0,
    totalWordsRead: Number(sessionStats.totalWordsRead) || 0,
    totalTimeSec: Number(sessionStats.totalTimeSec) || 0,
    platformAvgWpm: Math.round(Number(sessionStats.avgWpm) || 0),
    platformBestWpm: Number(sessionStats.bestWpm) || 0,
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

export default adminRouter;
