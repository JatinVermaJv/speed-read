import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { aiGenerationUsage, bookAiOutputs, books } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { lookupBestVolume, searchVolumes } from "../services/googleBooks";
import {
  bookSummaryKindSchema,
  generateBookAuthorBackground,
  generateBookApplyFirst,
  generateBookCompare,
  generateBookPhilosophicalAngles,
  generateBookQuoteExtraction,
  generateBookSummary,
  generateBookTakeawaysThemes,
} from "../services/openrouterBooks";
import { OpenRouterGenerationError } from "../services/openrouter";

const booksRouter = new Hono();

booksRouter.use("/*", authMiddleware);

const bookIdParamSchema = z.string().uuid();

booksRouter.use("/:id", async (c, next) => {
  const bookId = c.req.param("id");
  const parsed = bookIdParamSchema.safeParse(bookId);
  if (!parsed.success) {
    return c.json({ error: "validation_error", message: "Invalid book id" }, 400);
  }
  await next();
});

booksRouter.use("/:id/*", async (c, next) => {
  const bookId = c.req.param("id");
  const parsed = bookIdParamSchema.safeParse(bookId);
  if (!parsed.success) {
    return c.json({ error: "validation_error", message: "Invalid book id" }, 400);
  }
  await next();
});

const bookStatusSchema = z.enum(["to_read", "reading", "finished", "abandoned"]);

type BookStatus = z.infer<typeof bookStatusSchema>;

function makeTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function normalizeStatus(status: BookStatus): BookStatus {
  return status;
}

function normalizeRating(rating: number | null | undefined): number | null {
  if (rating === null || rating === undefined) return null;
  if (!Number.isFinite(rating)) return null;
  const n = Math.floor(rating);
  if (n < 1 || n > 5) return null;
  return n;
}

function deriveSourceText(book: { notes: string | null; description: string | null }): {
  sourceText: string | null;
  source: "notes" | "description" | null;
} {
  const notes = (book.notes ?? "").trim();
  if (notes) return { sourceText: notes, source: "notes" };

  const description = (book.description ?? "").trim();
  if (description) return { sourceText: description, source: "description" };

  return { sourceText: null, source: null };
}

function classifyOpenRouterFailure(error: unknown): {
  message: string;
  attemptedModels: string[];
  status: 429 | 503;
  retryAfterSeconds?: number;
} {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof OpenRouterGenerationError) {
    return {
      message,
      attemptedModels: error.attemptedModels,
      status: error.lastStatus === 429 ? 429 : 503,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  return { message, attemptedModels: [], status: 503 };
}

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function upsertAiOutput(params: {
  userId: string;
  bookId: string;
  kind: string;
  payload: unknown;
  model: string;
}) {
  const now = new Date();
  const payloadText = JSON.stringify(params.payload);

  const [row] = await db
    .insert(bookAiOutputs)
    .values({
      userId: params.userId,
      bookId: params.bookId,
      kind: params.kind,
      payload: payloadText,
      model: params.model,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [bookAiOutputs.bookId, bookAiOutputs.kind],
      set: {
        payload: payloadText,
        model: params.model,
        updatedAt: now,
      },
    })
    .returning({
      kind: bookAiOutputs.kind,
      payload: bookAiOutputs.payload,
      model: bookAiOutputs.model,
      createdAt: bookAiOutputs.createdAt,
      updatedAt: bookAiOutputs.updatedAt,
    });

  return row;
}

async function logAiUsage(params: {
  userId: string;
  feature: string;
  theme: string;
  model: string;
  status: "success" | "failed";
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(aiGenerationUsage).values({
    userId: params.userId,
    feature: params.feature,
    theme: params.theme,
    model: params.model,
    status: params.status,
    errorMessage: params.errorMessage ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });
}

// ─── List Books ────────────────────────────────────────────────────────────

booksRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      status: books.status,
      rating: books.rating,
      coverImageUrl: books.coverImageUrl,
      createdAt: books.createdAt,
      updatedAt: books.updatedAt,
    })
    .from(books)
    .where(eq(books.userId, userId))
    .orderBy(desc(books.updatedAt));

  return c.json({
    books: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
});

// ─── Create Book (auto metadata) ───────────────────────────────────────────

const createBookSchema = z.object({
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().min(1).max(255),
  status: bookStatusSchema.optional().default("to_read"),
  rating: z.number().int().min(1).max(5).optional(),
});

booksRouter.post("/", zValidator("json", createBookSchema), async (c) => {
  const userId = c.get("userId") as string;
  const body = c.req.valid("json");

  const traceId = makeTraceId();
  const title = sanitizeText(body.title);
  const author = sanitizeText(body.author);
  const status = normalizeStatus(body.status);
  const rating = normalizeRating(body.rating);

  const metadata = await lookupBestVolume({ title, author, traceId });

  const [created] = await db
    .insert(books)
    .values({
      userId,
      title,
      author,
      status,
      rating,
      googleVolumeId: metadata?.googleVolumeId ?? null,
      coverImageUrl: metadata?.coverImageUrl ?? null,
      description: metadata?.description ?? null,
      categories: metadata?.categories ?? null,
      publishedDate: metadata?.publishedDate ?? null,
      pageCount: metadata?.pageCount ?? null,
      publisher: metadata?.publisher ?? null,
      language: metadata?.language ?? null,
      previewLink: metadata?.previewLink ?? null,
      updatedAt: new Date(),
    })
    .returning();

  if (!created) {
    return c.json({ error: "create_failed", message: "Failed to create book" }, 500);
  }

  return c.json(
    {
      book: {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
      metadataFetched: Boolean(metadata),
    },
    201
  );
});

// ─── Get Book (includes AI outputs) ───────────────────────────────────────

booksRouter.get("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");

  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!book) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const outputs = await db
    .select({
      kind: bookAiOutputs.kind,
      payload: bookAiOutputs.payload,
      model: bookAiOutputs.model,
      createdAt: bookAiOutputs.createdAt,
      updatedAt: bookAiOutputs.updatedAt,
    })
    .from(bookAiOutputs)
    .where(and(eq(bookAiOutputs.bookId, bookId), eq(bookAiOutputs.userId, userId)))
    .orderBy(desc(bookAiOutputs.updatedAt));

  return c.json({
    book: {
      ...book,
      createdAt: book.createdAt.toISOString(),
      updatedAt: book.updatedAt.toISOString(),
    },
    aiOutputs: outputs.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
});

// ─── Update Book ───────────────────────────────────────────────────────────

const updateBookSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    author: z.string().trim().min(1).max(255).optional(),
    status: bookStatusSchema.optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().max(200000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

booksRouter.patch("/:id", zValidator("json", updateBookSchema), async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");
  const body = c.req.valid("json");

  const [existing] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const update: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (typeof body.title === "string") update.title = sanitizeText(body.title);
  if (typeof body.author === "string") update.author = sanitizeText(body.author);
  if (body.status) update.status = normalizeStatus(body.status);
  if (body.rating !== undefined) update.rating = normalizeRating(body.rating);
  if (body.notes !== undefined) update.notes = body.notes === null ? null : sanitizeText(body.notes);

  const [updated] = await db
    .update(books)
    .set(update)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .returning();

  if (!updated) {
    return c.json({ error: "update_failed", message: "Failed to update book" }, 500);
  }

  return c.json({
    book: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});

// ─── Refresh Metadata (safe-fail) ─────────────────────────────────────────-

booksRouter.post("/:id/refresh-metadata", async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");

  const [book] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!book) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const traceId = makeTraceId();
  const metadata = await lookupBestVolume({
    title: book.title,
    author: book.author,
    traceId,
  });

  if (!metadata) {
    const [current] = await db
      .select()
      .from(books)
      .where(and(eq(books.id, bookId), eq(books.userId, userId)))
      .limit(1);

    return c.json({
      refreshed: false,
      book: current
        ? {
            ...current,
            createdAt: current.createdAt.toISOString(),
            updatedAt: current.updatedAt.toISOString(),
          }
        : null,
    });
  }

  const [updated] = await db
    .update(books)
    .set({
      googleVolumeId: metadata.googleVolumeId,
      coverImageUrl: metadata.coverImageUrl,
      description: metadata.description,
      categories: metadata.categories,
      publishedDate: metadata.publishedDate,
      pageCount: metadata.pageCount,
      publisher: metadata.publisher,
      language: metadata.language,
      previewLink: metadata.previewLink,
      updatedAt: new Date(),
    })
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .returning();

  if (!updated) {
    return c.json({ refreshed: false, book: null }, 500);
  }

  return c.json({
    refreshed: true,
    book: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});

// ─── AI: Summary Suite ────────────────────────────────────────────────────

const summaryRequestSchema = z.object({
  kind: bookSummaryKindSchema,
});

booksRouter.post(
  "/:id/ai/summary",
  zValidator("json", summaryRequestSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const bookId = c.req.param("id");
    const body = c.req.valid("json");

    const [book] = await db
      .select({
        id: books.id,
        title: books.title,
        author: books.author,
        notes: books.notes,
        description: books.description,
      })
      .from(books)
      .where(and(eq(books.id, bookId), eq(books.userId, userId)))
      .limit(1);

    if (!book) {
      return c.json({ error: "not_found", message: "Book not found" }, 404);
    }

    const { sourceText, source } = deriveSourceText(book);

    const traceId = makeTraceId();
    const kind = `summary_${body.kind}`;

    try {
      const generated = await generateBookSummary({
        kind: body.kind,
        title: book.title,
        author: book.author,
        sourceText,
        traceId,
      });

      const stored = await upsertAiOutput({
        userId,
        bookId,
        kind,
        payload: generated.payload,
        model: generated.model,
      });

      await logAiUsage({
        userId,
        feature: "book_summary",
        theme: sanitizeText(book.title),
        model: generated.model,
        status: "success",
        metadata: { bookId, kind, source, hasSourceText: Boolean(sourceText) },
      });

      return c.json({
        kind,
        model: generated.model,
        payload: generated.payload,
        stored: stored
          ? {
              ...stored,
              createdAt: stored.createdAt.toISOString(),
              updatedAt: stored.updatedAt.toISOString(),
            }
          : null,
      });
    } catch (error) {
      const failure = classifyOpenRouterFailure(error);

      await logAiUsage({
        userId,
        feature: "book_summary",
        theme: sanitizeText(book.title),
        model: failure.attemptedModels[0] || "none",
        status: "failed",
        errorMessage: failure.message,
        metadata: {
          bookId,
          kind,
          source,
          hasSourceText: Boolean(sourceText),
          attemptedModels: failure.attemptedModels,
        },
      });

      if (failure.status === 429 && failure.retryAfterSeconds) {
        c.header("Retry-After", String(failure.retryAfterSeconds));
      }

      return c.json(
        { error: "generation_failed", message: failure.message },
        failure.status
      );
    }
  }
);

// ─── AI: Takeaways + Themes ───────────────────────────────────────────────

booksRouter.post("/:id/ai/takeaways-themes", async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");

  const [book] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      notes: books.notes,
      description: books.description,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!book) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const { sourceText, source } = deriveSourceText(book);

  const traceId = makeTraceId();
  const kind = "takeaways_themes";

  try {
    const generated = await generateBookTakeawaysThemes({
      title: book.title,
      author: book.author,
      sourceText,
      traceId,
    });

    const stored = await upsertAiOutput({
      userId,
      bookId,
      kind,
      payload: generated.payload,
      model: generated.model,
    });

    await logAiUsage({
      userId,
      feature: "book_takeaways_themes",
      theme: sanitizeText(book.title),
      model: generated.model,
      status: "success",
      metadata: { bookId, kind, source, hasSourceText: Boolean(sourceText) },
    });

    return c.json({
      kind,
      model: generated.model,
      payload: generated.payload,
      stored: stored
        ? {
            ...stored,
            createdAt: stored.createdAt.toISOString(),
            updatedAt: stored.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    const failure = classifyOpenRouterFailure(error);

    await logAiUsage({
      userId,
      feature: "book_takeaways_themes",
      theme: sanitizeText(book.title),
      model: failure.attemptedModels[0] || "none",
      status: "failed",
      errorMessage: failure.message,
      metadata: {
        bookId,
        kind,
        source,
        hasSourceText: Boolean(sourceText),
        attemptedModels: failure.attemptedModels,
      },
    });

    if (failure.status === 429 && failure.retryAfterSeconds) {
      c.header("Retry-After", String(failure.retryAfterSeconds));
    }

    return c.json(
      { error: "generation_failed", message: failure.message },
      failure.status
    );
  }
});

// ─── AI: Philosophical Angles ─────────────────────────────────────────────

booksRouter.post("/:id/ai/philosophy", async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");

  const [book] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      notes: books.notes,
      description: books.description,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!book) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const { sourceText, source } = deriveSourceText(book);

  const traceId = makeTraceId();
  const kind = "philosophical_angles";

  try {
    const generated = await generateBookPhilosophicalAngles({
      title: book.title,
      author: book.author,
      sourceText,
      traceId,
    });

    const stored = await upsertAiOutput({
      userId,
      bookId,
      kind,
      payload: generated.payload,
      model: generated.model,
    });

    await logAiUsage({
      userId,
      feature: "book_philosophical_angles",
      theme: sanitizeText(book.title),
      model: generated.model,
      status: "success",
      metadata: { bookId, kind, source, hasSourceText: Boolean(sourceText) },
    });

    return c.json({
      kind,
      model: generated.model,
      payload: generated.payload,
      stored: stored
        ? {
            ...stored,
            createdAt: stored.createdAt.toISOString(),
            updatedAt: stored.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    const failure = classifyOpenRouterFailure(error);

    await logAiUsage({
      userId,
      feature: "book_philosophical_angles",
      theme: sanitizeText(book.title),
      model: failure.attemptedModels[0] || "none",
      status: "failed",
      errorMessage: failure.message,
      metadata: {
        bookId,
        kind,
        source,
        hasSourceText: Boolean(sourceText),
        attemptedModels: failure.attemptedModels,
      },
    });

    if (failure.status === 429 && failure.retryAfterSeconds) {
      c.header("Retry-After", String(failure.retryAfterSeconds));
    }

    return c.json(
      { error: "generation_failed", message: failure.message },
      failure.status
    );
  }
});

// ─── AI: Quote Extraction ────────────────────────────────────────────────

booksRouter.post("/:id/ai/quotes", async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");

  const [book] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      notes: books.notes,
      description: books.description,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!book) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const { sourceText, source } = deriveSourceText(book);

  const traceId = makeTraceId();
  const kind = "quote_extraction";

  if (!sourceText) {
    const payload = {
      quotes: [],
      note: "No notes/description were provided, so there is nothing to extract verbatim quotes from. Add notes (or refresh metadata) to enable quote extraction.",
    };

    const stored = await upsertAiOutput({
      userId,
      bookId,
      kind,
      payload,
      model: "none",
    });

    await logAiUsage({
      userId,
      feature: "book_quote_extraction",
      theme: sanitizeText(book.title),
      model: "none",
      status: "success",
      metadata: { bookId, kind, source, hasSourceText: false },
    });

    return c.json({
      kind,
      model: "none",
      payload,
      stored: stored
        ? {
            ...stored,
            createdAt: stored.createdAt.toISOString(),
            updatedAt: stored.updatedAt.toISOString(),
          }
        : null,
    });
  }

  try {
    const generated = await generateBookQuoteExtraction({
      title: book.title,
      author: book.author,
      sourceText,
      traceId,
    });

    const stored = await upsertAiOutput({
      userId,
      bookId,
      kind,
      payload: generated.payload,
      model: generated.model,
    });

    await logAiUsage({
      userId,
      feature: "book_quote_extraction",
      theme: sanitizeText(book.title),
      model: generated.model,
      status: "success",
      metadata: { bookId, kind, source, hasSourceText: true },
    });

    return c.json({
      kind,
      model: generated.model,
      payload: generated.payload,
      stored: stored
        ? {
            ...stored,
            createdAt: stored.createdAt.toISOString(),
            updatedAt: stored.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    const failure = classifyOpenRouterFailure(error);

    await logAiUsage({
      userId,
      feature: "book_quote_extraction",
      theme: sanitizeText(book.title),
      model: failure.attemptedModels[0] || "none",
      status: "failed",
      errorMessage: failure.message,
      metadata: {
        bookId,
        kind,
        source,
        hasSourceText: true,
        attemptedModels: failure.attemptedModels,
      },
    });

    if (failure.status === 429 && failure.retryAfterSeconds) {
      c.header("Retry-After", String(failure.retryAfterSeconds));
    }

    return c.json(
      { error: "generation_failed", message: failure.message },
      failure.status
    );
  }
});

// ─── AI: Apply First ──────────────────────────────────────────────────────

const applyFirstSchema = z.object({
  goal: z.string().trim().max(400).optional(),
});

booksRouter.post(
  "/:id/ai/apply-first",
  zValidator("json", applyFirstSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const bookId = c.req.param("id");
    const body = c.req.valid("json");

    const [book] = await db
      .select({
        id: books.id,
        title: books.title,
        author: books.author,
        notes: books.notes,
        description: books.description,
      })
      .from(books)
      .where(and(eq(books.id, bookId), eq(books.userId, userId)))
      .limit(1);

    if (!book) {
      return c.json({ error: "not_found", message: "Book not found" }, 404);
    }

    const { sourceText, source } = deriveSourceText(book);

    const traceId = makeTraceId();
    const kind = "apply_first";

    try {
      const generated = await generateBookApplyFirst({
        title: book.title,
        author: book.author,
        sourceText,
        goal: body.goal,
        traceId,
      });

      const stored = await upsertAiOutput({
        userId,
        bookId,
        kind,
        payload: generated.payload,
        model: generated.model,
      });

      await logAiUsage({
        userId,
        feature: "book_apply_first",
        theme: sanitizeText(book.title),
        model: generated.model,
        status: "success",
        metadata: { bookId, kind, source, hasSourceText: Boolean(sourceText) },
      });

      return c.json({
        kind,
        model: generated.model,
        payload: generated.payload,
        stored: stored
          ? {
              ...stored,
              createdAt: stored.createdAt.toISOString(),
              updatedAt: stored.updatedAt.toISOString(),
            }
          : null,
      });
    } catch (error) {
      const failure = classifyOpenRouterFailure(error);

      await logAiUsage({
        userId,
        feature: "book_apply_first",
        theme: sanitizeText(book.title),
        model: failure.attemptedModels[0] || "none",
        status: "failed",
        errorMessage: failure.message,
        metadata: {
          bookId,
          kind,
          source,
          hasSourceText: Boolean(sourceText),
          attemptedModels: failure.attemptedModels,
        },
      });

      if (failure.status === 429 && failure.retryAfterSeconds) {
        c.header("Retry-After", String(failure.retryAfterSeconds));
      }

      return c.json(
        { error: "generation_failed", message: failure.message },
        failure.status
      );
    }
  }
);

// ─── AI: Recommendations (Google Books metadata only) ────────────────────

booksRouter.post("/:id/ai/recommendations", async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");

  const [book] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      notes: books.notes,
      description: books.description,
      categories: books.categories,
      googleVolumeId: books.googleVolumeId,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!book) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const traceId = makeTraceId();
  const kind = "recommendations";

  const categoryList = (book.categories ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 3);

  const queries = [
    ...categoryList.map((cat) => `subject:${cat}`),
    `intitle:${book.title}`,
    `inauthor:${book.author}`,
    `${book.title} ${book.author}`,
  ];

  const currentVolumeId = (book.googleVolumeId ?? "").trim();
  const currentKey = normalizeKey(`${book.title}|${book.author}`);

  const collected: Array<Awaited<ReturnType<typeof searchVolumes>>[number]> = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  const addCandidate = (cnd: (typeof collected)[number]) => {
    if (currentVolumeId && cnd.googleVolumeId === currentVolumeId) return;
    if (typeof cnd.title !== "string" || cnd.title.trim().length === 0) return;

    const key = normalizeKey(`${cnd.title}|${cnd.author ?? ""}`);
    if (!key || key === currentKey) return;
    if (seenIds.has(cnd.googleVolumeId)) return;
    if (seenKeys.has(key)) return;

    seenIds.add(cnd.googleVolumeId);
    seenKeys.add(key);
    collected.push(cnd);
  };

  const queriesUsed: string[] = [];
  for (const q of queries) {
    if (collected.length >= 10) break;
    if (!q.trim()) continue;

    queriesUsed.push(q);
    const batch = await searchVolumes({ q, maxResults: 20, traceId });
    for (const cnd of batch) addCandidate(cnd);
  }

  const payload = {
    recommendations: collected.slice(0, 20).map((cnd) => ({
      googleVolumeId: cnd.googleVolumeId,
      title: cnd.title,
      author: cnd.author,
      coverImageUrl: cnd.coverImageUrl,
      previewLink: cnd.previewLink,
      categories: cnd.categories,
      description: cnd.description,
      publishedDate: cnd.publishedDate,
      pageCount: cnd.pageCount,
      publisher: cnd.publisher,
      language: cnd.language,
    })),
    note: collected.length < 10
      ? `Found ${collected.length} results from Google Books for this book.`
      : undefined,
    candidateQueries: queriesUsed,
  };

  const stored = await upsertAiOutput({
    userId,
    bookId,
    kind,
    payload,
    model: "google_books",
  });

  await logAiUsage({
    userId,
    feature: "book_recommendations",
    theme: sanitizeText(book.title),
    model: "google_books",
    status: "success",
    metadata: {
      bookId,
      kind,
      candidateQueries: queriesUsed,
      recommendationCount: payload.recommendations.length,
      excludedVolumeId: currentVolumeId || null,
    },
  });

  return c.json({
    kind,
    model: "google_books",
    payload,
    stored: stored
      ? {
          ...stored,
          createdAt: stored.createdAt.toISOString(),
          updatedAt: stored.updatedAt.toISOString(),
        }
      : null,
  });
});

// ─── AI: Author Background (Hybrid: Google Books + LLM summary) ──────────

booksRouter.post("/:id/ai/author-background", async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");

  const [book] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      notes: books.notes,
      description: books.description,
      googleVolumeId: books.googleVolumeId,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!book) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const { sourceText, source } = deriveSourceText(book);

  const traceId = makeTraceId();
  const kind = "author_background";

  const authorCandidates = await searchVolumes({
    q: `inauthor:${book.author}`,
    maxResults: 12,
    traceId,
  });

  const filtered = authorCandidates
    .filter((cnd) => cnd.googleVolumeId !== (book.googleVolumeId ?? ""))
    .filter((cnd) => typeof cnd.title === "string" && cnd.title.trim().length > 0);

  const uniq: typeof filtered = [];
  const seen = new Set<string>();
  for (const cnd of filtered) {
    const key = normalizeKey(`${cnd.title ?? ""}|${cnd.author ?? ""}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(cnd);
  }

  try {
    const generated = await generateBookAuthorBackground({
      title: book.title,
      author: book.author,
      sourceText,
      authorBooks: uniq.slice(0, 12).map((cnd) => ({
        id: cnd.googleVolumeId,
        title: cnd.title ?? "",
        description: cnd.description,
      })),
      traceId,
    });

    const byId = new Map(uniq.map((cnd) => [cnd.googleVolumeId, cnd] as const));
    const byTitle = new Map<string, (typeof uniq)[number]>();
    for (const cnd of uniq) {
      if (cnd.title) byTitle.set(normalizeKey(cnd.title), cnd);
    }

    const suggestedNextReads = generated.payload.suggestedNextReads.map((rec) => {
      const matchedById = rec.id ? byId.get(rec.id) : undefined;
      const matchedByTitle = !matchedById && rec.title ? byTitle.get(normalizeKey(rec.title)) : undefined;
      const matched = matchedById || matchedByTitle;

      return {
        googleVolumeId: matched?.googleVolumeId ?? rec.id ?? null,
        title: matched?.title ?? rec.title,
        coverImageUrl: matched?.coverImageUrl ?? null,
        previewLink: matched?.previewLink ?? null,
        why: rec.why,
      };
    });

    const payload = {
      authorSnapshot: generated.payload.authorSnapshot,
      commonThemes: generated.payload.commonThemes,
      suggestedNextReads,
      note: generated.payload.note,
    };

    const stored = await upsertAiOutput({
      userId,
      bookId,
      kind,
      payload,
      model: generated.model,
    });

    await logAiUsage({
      userId,
      feature: "book_author_background",
      theme: sanitizeText(book.title),
      model: generated.model,
      status: "success",
      metadata: {
        bookId,
        kind,
        source,
        hasSourceText: Boolean(sourceText),
        authorCandidateCount: uniq.length,
      },
    });

    return c.json({
      kind,
      model: generated.model,
      payload,
      stored: stored
        ? {
            ...stored,
            createdAt: stored.createdAt.toISOString(),
            updatedAt: stored.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    const failure = classifyOpenRouterFailure(error);

    await logAiUsage({
      userId,
      feature: "book_author_background",
      theme: sanitizeText(book.title),
      model: failure.attemptedModels[0] || "none",
      status: "failed",
      errorMessage: failure.message,
      metadata: {
        bookId,
        kind,
        source,
        hasSourceText: Boolean(sourceText),
        authorCandidateCount: uniq.length,
        attemptedModels: failure.attemptedModels,
      },
    });

    if (failure.status === 429 && failure.retryAfterSeconds) {
      c.header("Retry-After", String(failure.retryAfterSeconds));
    }

    return c.json(
      { error: "generation_failed", message: failure.message },
      failure.status
    );
  }
});

// ─── AI: Compare Two Books ───────────────────────────────────────────────

const compareSchema = z.object({
  otherBookId: z.string().uuid(),
});

booksRouter.post("/:id/ai/compare", zValidator("json", compareSchema), async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");
  const body = c.req.valid("json");

  const [bookA] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      notes: books.notes,
      description: books.description,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!bookA) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  const [bookB] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      notes: books.notes,
      description: books.description,
    })
    .from(books)
    .where(and(eq(books.id, body.otherBookId), eq(books.userId, userId)))
    .limit(1);

  if (!bookB) {
    return c.json({ error: "not_found", message: "Comparison book not found" }, 404);
  }

  const a = deriveSourceText(bookA);
  const b = deriveSourceText(bookB);

  const traceId = makeTraceId();
  const kind = `compare_${bookB.id}`;

  try {
    const generated = await generateBookCompare({
      bookATitle: bookA.title,
      bookAAuthor: bookA.author,
      bookASourceText: a.sourceText,
      bookBTitle: bookB.title,
      bookBAuthor: bookB.author,
      bookBSourceText: b.sourceText,
      traceId,
    });

    const payload = {
      bookA: { id: bookA.id, title: bookA.title, author: bookA.author, source: a.source },
      bookB: { id: bookB.id, title: bookB.title, author: bookB.author, source: b.source },
      ...generated.payload,
    };

    const stored = await upsertAiOutput({
      userId,
      bookId,
      kind,
      payload,
      model: generated.model,
    });

    await logAiUsage({
      userId,
      feature: "book_compare",
      theme: sanitizeText(bookA.title),
      model: generated.model,
      status: "success",
      metadata: {
        bookId,
        kind,
        otherBookId: bookB.id,
        sourceA: a.source,
        sourceB: b.source,
        hasSourceTextA: Boolean(a.sourceText),
        hasSourceTextB: Boolean(b.sourceText),
      },
    });

    return c.json({
      kind,
      model: generated.model,
      payload,
      stored: stored
        ? {
            ...stored,
            createdAt: stored.createdAt.toISOString(),
            updatedAt: stored.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    const failure = classifyOpenRouterFailure(error);

    await logAiUsage({
      userId,
      feature: "book_compare",
      theme: sanitizeText(bookA.title),
      model: failure.attemptedModels[0] || "none",
      status: "failed",
      errorMessage: failure.message,
      metadata: {
        bookId,
        kind,
        otherBookId: bookB.id,
        attemptedModels: failure.attemptedModels,
      },
    });

    if (failure.status === 429 && failure.retryAfterSeconds) {
      c.header("Retry-After", String(failure.retryAfterSeconds));
    }

    return c.json(
      { error: "generation_failed", message: failure.message },
      failure.status
    );
  }
});

// ─── Delete Book ───────────────────────────────────────────────────────────

booksRouter.delete("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const bookId = c.req.param("id");

  const [existing] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "not_found", message: "Book not found" }, 404);
  }

  await db.delete(books).where(and(eq(books.id, bookId), eq(books.userId, userId)));

  return c.json({ message: "Book deleted" });
});

export default booksRouter;
