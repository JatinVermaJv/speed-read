import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, sql, avg, max, count, sum } from "drizzle-orm";
import { db } from "../db";
import { sessions, passages } from "../db/schema";
import { authMiddleware } from "../middleware/auth";

const sessionsRouter = new Hono();

// All session routes require authentication
sessionsRouter.use("/*", authMiddleware);

// ─── Save Session ───────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  passageId: z.string().uuid().nullable().optional(),
  startWpm: z.number().int().min(1),
  endWpm: z.number().int().min(1),
  wpmIncrement: z.number().int().min(0),
  incrementIntervalSec: z.number().int().min(1),
  totalWordsRead: z.number().int().min(0),
  durationSec: z.number().int().min(0),
  stoppedByUser: z.boolean(),
});

sessionsRouter.post(
  "/",
  zValidator("json", createSessionSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const data = c.req.valid("json");

    const [session] = await db
      .insert(sessions)
      .values({
        userId,
        passageId: data.passageId || null,
        startWpm: data.startWpm,
        endWpm: data.endWpm,
        wpmIncrement: data.wpmIncrement,
        incrementIntervalSec: data.incrementIntervalSec,
        totalWordsRead: data.totalWordsRead,
        durationSec: data.durationSec,
        stoppedByUser: data.stoppedByUser,
      })
      .returning();

    return c.json({ session }, 201);
  }
);

// ─── List Sessions ──────────────────────────────────────────────────────────

sessionsRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = (page - 1) * limit;

  const result = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      passageId: sessions.passageId,
      passageTitle: passages.title,
      startWpm: sessions.startWpm,
      endWpm: sessions.endWpm,
      wpmIncrement: sessions.wpmIncrement,
      incrementIntervalSec: sessions.incrementIntervalSec,
      totalWordsRead: sessions.totalWordsRead,
      durationSec: sessions.durationSec,
      stoppedByUser: sessions.stoppedByUser,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .leftJoin(passages, eq(sessions.passageId, passages.id))
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ sessions: result, page, limit });
});

// ─── Session Stats ──────────────────────────────────────────────────────────

sessionsRouter.get("/stats", async (c) => {
  const userId = c.get("userId") as string;

  // Aggregate stats
  const [stats] = await db
    .select({
      totalSessions: count(sessions.id),
      totalWordsRead: sum(sessions.totalWordsRead),
      bestWpm: max(sessions.endWpm),
      averageWpm: avg(sessions.endWpm),
    })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  // WPM over time (last 30 sessions)
  const wpmOverTime = await db
    .select({
      date: sessions.createdAt,
      wpm: sessions.endWpm,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sessions.createdAt)
    .limit(30);

  return c.json({
    totalSessions: Number(stats.totalSessions) || 0,
    totalWordsRead: Number(stats.totalWordsRead) || 0,
    bestWpm: Number(stats.bestWpm) || 0,
    averageWpm: Math.round(Number(stats.averageWpm) || 0),
    wpmOverTime: wpmOverTime.map((row) => ({
      date: row.date.toISOString(),
      wpm: row.wpm,
    })),
  });
});

export default sessionsRouter;
