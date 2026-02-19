import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, or, and, isNull } from "drizzle-orm";
import { db } from "../db";
import { passages } from "../db/schema";
import { authMiddleware } from "../middleware/auth";

const passagesRouter = new Hono();

// All passage routes require authentication
passagesRouter.use("/*", authMiddleware);

// ─── List Passages ──────────────────────────────────────────────────────────

passagesRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const result = await db
    .select()
    .from(passages)
    .where(
      or(eq(passages.isDefault, true), eq(passages.userId, userId))
    )
    .orderBy(passages.createdAt);

  return c.json({ passages: result });
});

// ─── Create Custom Passage ──────────────────────────────────────────────────

const createPassageSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  category: z.string().min(1).max(100).default("Custom"),
});

passagesRouter.post(
  "/",
  zValidator("json", createPassageSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const { title, content, category } = c.req.valid("json");

    // Strip HTML tags for security
    const sanitizedContent = content.replace(/<[^>]*>/g, "");
    const wordCount = sanitizedContent
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    if (wordCount < 20) {
      return c.json(
        {
          error: "validation_error",
          message: "Passage must contain at least 20 words",
        },
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
        isDefault: false,
        userId,
      })
      .returning();

    return c.json({ passage }, 201);
  }
);

// ─── Delete Custom Passage ──────────────────────────────────────────────────

passagesRouter.delete("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const passageId = c.req.param("id");

  // Only allow deleting own non-default passages
  const [passage] = await db
    .select()
    .from(passages)
    .where(
      and(
        eq(passages.id, passageId),
        eq(passages.userId, userId),
        eq(passages.isDefault, false)
      )
    )
    .limit(1);

  if (!passage) {
    return c.json(
      { error: "not_found", message: "Passage not found or cannot be deleted" },
      404
    );
  }

  await db.delete(passages).where(eq(passages.id, passageId));

  return c.json({ message: "Passage deleted" });
});

export default passagesRouter;
