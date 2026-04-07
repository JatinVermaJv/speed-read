import { z } from "zod";
import { OpenRouterGenerationError, OpenRouterHttpError } from "./openrouter";
import {
  callOpenRouterJson,
  parseModelsFromEnv,
  type OpenRouterLogFn,
} from "./openrouterJsonClient";

const DEBUG_OPENROUTER = (() => {
  const raw = (
    process.env.DEBUG_OPENROUTER ||
    process.env.OPENROUTER_DEBUG ||
    ""
  )
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
})();

function logPrefix(traceId?: string) {
  return traceId ? `[openrouter:books:${traceId}]` : "[openrouter:books]";
}

const logDebug: OpenRouterLogFn = (traceId, message, meta) => {
  if (!DEBUG_OPENROUTER) return;
  if (meta) {
    console.log(logPrefix(traceId), message, meta);
    return;
  }
  console.log(logPrefix(traceId), message);
};

const logError: OpenRouterLogFn = (traceId, message, meta) => {
  if (meta) {
    console.error(logPrefix(traceId), message, meta);
    return;
  }
  console.error(logPrefix(traceId), message);
};

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

function sanitizeSourceText(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return input.slice(0, maxChars);
}

function normalizeSourceText(
  value: string | null | undefined,
  maxChars: number
): string | null {
  if (typeof value !== "string") return null;
  const sanitized = sanitizeSourceText(value);
  if (!sanitized) return null;
  return truncate(sanitized, maxChars);
}

const bookSummaryTldrSchema = z.object({
  tldr: z.string().trim().min(20).max(600),
  bullets: z.array(z.string().trim().min(3).max(220)).min(3).max(7),
});

const bookSummaryConciseSchema = z.object({
  summary: z.string().trim().min(80).max(1800),
  bullets: z.array(z.string().trim().min(3).max(220)).min(3).max(10),
});

const bookSummaryDeepSchema = z.object({
  overview: z.string().trim().min(200).max(5000),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(3).max(120),
        summary: z.string().trim().min(80).max(1400),
      })
    )
    .min(3)
    .max(10),
  keyInsights: z.array(z.string().trim().min(5).max(220)).min(5).max(14),
});

const bookSummarySkimmableSchema = z.object({
  headline: z.string().trim().min(10).max(220),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(3).max(120),
        bullets: z.array(z.string().trim().min(5).max(220)).min(2).max(6),
      })
    )
    .min(4)
    .max(12),
});

const bookTakeawaysThemesSchema = z.object({
  themes: z.array(z.string().trim().min(3).max(120)).min(3).max(10),
  takeaways: z.array(z.string().trim().min(5).max(220)).min(5).max(12),
});

const bookPhilosophicalAnglesSchema = z.object({
  angles: z
    .array(
      z.object({
        lens: z.string().trim().min(3).max(80),
        angle: z.string().trim().min(60).max(600),
      })
    )
    .min(3)
    .max(8),
  questions: z.array(z.string().trim().min(8).max(200)).min(3).max(10),
});

const bookQuoteExtractionSchema = z.object({
  quotes: z
    .array(
      z.object({
        quote: z.string().trim().min(6).max(320),
        context: z.string().trim().min(8).max(260),
        whyItMatters: z.string().trim().min(8).max(260),
      })
    )
    .max(12),
  note: z.string().trim().max(300).optional(),
});

const bookApplyFirstSchema = z.object({
  topActions: z
    .array(
      z.object({
        action: z.string().trim().min(10).max(220),
        why: z.string().trim().min(20).max(280),
        firstStep: z.string().trim().min(10).max(180),
      })
    )
    .min(3)
    .max(5),
});

const bookRecommendationsSchema = z.object({
  recommendations: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80).optional(),
        title: z.string().trim().min(2).max(500),
        author: z.string().trim().min(2).max(255).nullable().optional(),
        reason: z.string().trim().min(30).max(700),
        similarityTags: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
        whatToCompare: z.array(z.string().trim().min(3).max(90)).max(10).default([]),
      })
    )
    .min(3)
    .max(8),
  note: z.string().trim().max(400).optional(),
});

const bookAuthorBackgroundSchema = z.object({
  authorSnapshot: z.string().trim().min(80).max(1600),
  commonThemes: z.array(z.string().trim().min(3).max(120)).min(3).max(12),
  suggestedNextReads: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80).optional(),
        title: z.string().trim().min(2).max(500),
        why: z.string().trim().min(20).max(520),
      })
    )
    .max(6)
    .default([]),
  note: z.string().trim().max(400).optional(),
});

const bookCompareSchema = z.object({
  similarities: z.array(z.string().trim().min(5).max(220)).min(3).max(12),
  differences: z
    .array(
      z.object({
        dimension: z.string().trim().min(3).max(80),
        bookA: z.string().trim().min(12).max(520),
        bookB: z.string().trim().min(12).max(520),
      })
    )
    .min(3)
    .max(12),
  whoShouldReadWhich: z.string().trim().min(80).max(1100),
  ifReadingBoth: z.string().trim().min(40).max(700),
});

export const bookSummaryKindSchema = z.enum(["tldr", "concise", "deep", "skimmable"]);
export type BookSummaryKind = z.infer<typeof bookSummaryKindSchema>;

export type BookAiPayload =
  | z.infer<typeof bookSummaryTldrSchema>
  | z.infer<typeof bookSummaryConciseSchema>
  | z.infer<typeof bookSummaryDeepSchema>
  | z.infer<typeof bookSummarySkimmableSchema>
  | z.infer<typeof bookTakeawaysThemesSchema>
  | z.infer<typeof bookPhilosophicalAnglesSchema>
  | z.infer<typeof bookQuoteExtractionSchema>
  | z.infer<typeof bookApplyFirstSchema>
  | z.infer<typeof bookRecommendationsSchema>
  | z.infer<typeof bookAuthorBackgroundSchema>
  | z.infer<typeof bookCompareSchema>;

function baseSystemJsonInstruction(shapeHint: string) {
  return `You are a careful book assistant. Return ONLY valid JSON (no markdown, no code fences). Output must match this shape exactly: ${shapeHint}.\nRules:\n- Always return the full JSON shape (never refuse); if details are missing, use generic high-level content that still fits the requested structure.\n- If SOURCE TEXT is provided, ground your answer in it and do not contradict it.\n- If SOURCE TEXT is missing/empty, generate using only the book title and author; keep it high-level and use cautious language ("likely", "may", "often").\n- Do not output verbatim excerpts or lines from the book. Avoid quotation marks unless you are explicitly asked to extract quotes AND the quote appears in SOURCE TEXT.\n- Never invent direct quotes. Only include verbatim quotes if they appear in SOURCE TEXT.\n- Do not invent bibliographic facts (dates, page counts) or claim certainty when you are unsure.\n- Keep language safe for all ages.`;
}

function baseSystemJsonInstructionFromInputs(shapeHint: string) {
  return `You are a careful book assistant. Return ONLY valid JSON (no markdown, no code fences). Output must match this shape exactly: ${shapeHint}.\nRules:\n- Always return the full JSON shape (never refuse); if details are missing, use generic high-level content that still fits the requested structure.\n- Use ONLY the provided inputs (book context + any candidate lists).\n- If SOURCE TEXT is missing/empty, keep your output general and avoid specific factual claims you cannot verify.\n- Do not output verbatim excerpts or lines from the book. Avoid quotation marks unless you are explicitly asked to extract quotes AND the quote appears in SOURCE TEXT.\n- Do not invent bibliographic facts (dates, page counts), and never invent direct quotes.\n- If details are missing, use cautious language ("may", "might") and keep it general.`;
}

function buildContext(params: {
  title: string;
  author: string;
  sourceText?: string | null;
  goal?: string;
}) {
  const goalText = params.goal?.trim() ? `\nUser goal: ${params.goal.trim()}` : "";

  const sourceBlock = params.sourceText
    ? `SOURCE TEXT (user notes / Google Books description):\n${params.sourceText}`
    : "SOURCE TEXT: (none provided)";

  return `Book title: ${params.title}\nAuthor: ${params.author}${goalText}\n\n${sourceBlock}`;
}

async function generateWithModels<T>(params: {
  traceId?: string;
  messages: Array<{ role: string; content: string }>;
  schema: z.ZodType<T>;
  maxTokens: number;
  temperature?: number;
}): Promise<{ model: string; payload: T }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const traceId = params.traceId;

  if (!apiKey) {
    logError(traceId, "config.missing_api_key", {
      hasOpenRouterModels: Boolean(process.env.OPENROUTER_MODELS?.trim()),
      hasOpenRouterModel: Boolean(process.env.OPENROUTER_MODEL?.trim()),
    });
    throw new OpenRouterGenerationError("OPENROUTER_API_KEY is not configured", []);
  }

  const models = parseModelsFromEnv();
  const attempted: string[] = [];
  let lastError = "Unknown generation error";
  let lastStatus: number | undefined;
  let retryAfterSeconds: number | undefined;

  for (const model of models) {
    attempted.push(model);

    try {
      const payload = await callOpenRouterJson(
        apiKey,
        model,
        traceId,
        params.messages,
        params.schema,
        params.maxTokens,
        { temperature: params.temperature ?? 0.4, logDebug, logError }
      );

      return { model, payload };
    } catch (error) {
      const details = formatUnknownError(error);
      lastError = details.message;

      if (error instanceof OpenRouterHttpError) {
        lastStatus = error.status;
        retryAfterSeconds = error.retryAfterSeconds;
      }

      logError(traceId, "model.failed", { model, ...details });
    }
  }

  throw new OpenRouterGenerationError(
    `OpenRouter generation failed: ${lastError}`,
    attempted,
    { lastStatus, retryAfterSeconds }
  );
}

export async function generateBookSummary(params: {
  kind: BookSummaryKind;
  title: string;
  author: string;
  sourceText?: string | null;
  traceId?: string;
}): Promise<{ model: string; payload: BookAiPayload }> {
  const sourceText = normalizeSourceText(params.sourceText, 50_000);

  if (params.kind === "tldr") {
    const result = await generateWithModels({
      traceId: params.traceId,
      maxTokens: 600,
      schema: bookSummaryTldrSchema,
      messages: [
        { role: "system", content: baseSystemJsonInstruction("{ tldr: string, bullets: string[] }") },
        {
          role: "user",
          content:
            buildContext({
              title: params.title,
              author: params.author,
              sourceText,
            }) +
            "\n\nTask: Write a TLDR and 3–7 bullets. Keep TLDR to 1–3 sentences.",
        },
      ],
    });

    return { model: result.model, payload: result.payload };
  }

  if (params.kind === "concise") {
    const result = await generateWithModels({
      traceId: params.traceId,
      maxTokens: 1100,
      schema: bookSummaryConciseSchema,
      messages: [
        {
          role: "system",
          content: baseSystemJsonInstruction("{ summary: string, bullets: string[] }"),
        },
        {
          role: "user",
          content:
            buildContext({
              title: params.title,
              author: params.author,
              sourceText,
            }) +
            "\n\nTask: Produce a concise 2–4 paragraph summary and 3–10 bullets.",
        },
      ],
    });

    return { model: result.model, payload: result.payload };
  }

  if (params.kind === "deep") {
    const result = await generateWithModels({
      traceId: params.traceId,
      maxTokens: 1800,
      schema: bookSummaryDeepSchema,
      messages: [
        {
          role: "system",
          content:
            baseSystemJsonInstruction(
              "{ overview: string, sections: { heading: string, summary: string }[], keyInsights: string[] }"
            ) +
            "\nExtra: Sections should be thematic, not chapter numbers.",
        },
        {
          role: "user",
          content:
            buildContext({
              title: params.title,
              author: params.author,
              sourceText,
            }) +
            "\n\nTask: Write a deep summary with an overview, 3–10 themed sections, and 5–14 key insights.",
        },
      ],
    });

    return { model: result.model, payload: result.payload };
  }

  const result = await generateWithModels({
    traceId: params.traceId,
    maxTokens: 1500,
    schema: bookSummarySkimmableSchema,
    messages: [
      {
        role: "system",
        content:
          baseSystemJsonInstruction(
            "{ headline: string, sections: { heading: string, bullets: string[] }[] }"
          ) + "\nExtra: Make it very scannable.",
      },
      {
        role: "user",
        content:
          buildContext({
            title: params.title,
            author: params.author,
            sourceText,
          }) + "\n\nTask: Create a skimmable outline with 4–12 sections.",
      },
    ],
  });

  return { model: result.model, payload: result.payload };
}

export async function generateBookTakeawaysThemes(params: {
  title: string;
  author: string;
  sourceText?: string | null;
  traceId?: string;
}): Promise<{ model: string; payload: z.infer<typeof bookTakeawaysThemesSchema> }> {
  const sourceText = normalizeSourceText(params.sourceText, 50_000);

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1100,
    schema: bookTakeawaysThemesSchema,
    messages: [
      {
        role: "system",
        content: baseSystemJsonInstruction("{ themes: string[], takeaways: string[] }"),
      },
      {
        role: "user",
        content:
          buildContext({ title: params.title, author: params.author, sourceText }) +
          "\n\nTask: Extract 3–10 themes and 5–12 key takeaways phrased as actionable insights.",
      },
    ],
  });
}

export async function generateBookPhilosophicalAngles(params: {
  title: string;
  author: string;
  sourceText?: string | null;
  traceId?: string;
}): Promise<{ model: string; payload: z.infer<typeof bookPhilosophicalAnglesSchema> }> {
  const sourceText = normalizeSourceText(params.sourceText, 50_000);

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1200,
    schema: bookPhilosophicalAnglesSchema,
    messages: [
      {
        role: "system",
        content: baseSystemJsonInstruction(
          "{ angles: { lens: string, angle: string }[], questions: string[] }"
        ),
      },
      {
        role: "user",
        content:
          buildContext({ title: params.title, author: params.author, sourceText }) +
          "\n\nTask: Provide 3–8 philosophical lenses/angles and 3–10 discussion questions for reflection.",
      },
    ],
  });
}

export async function generateBookQuoteExtraction(params: {
  title: string;
  author: string;
  sourceText: string;
  traceId?: string;
}): Promise<{ model: string; payload: z.infer<typeof bookQuoteExtractionSchema> }> {
  const sourceText = truncate(sanitizeSourceText(params.sourceText), 50_000);

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 900,
    schema: bookQuoteExtractionSchema,
    messages: [
      {
        role: "system",
        content:
          baseSystemJsonInstruction(
            "{ quotes: { quote: string, context: string, whyItMatters: string }[], note?: string }"
          ) +
          "\nImportant: ONLY include quotes that appear verbatim in the SOURCE TEXT. If there are no direct quotes, return quotes: [] and a short note.",
      },
      {
        role: "user",
        content:
          buildContext({ title: params.title, author: params.author, sourceText }) +
          "\n\nTask: Extract up to 12 impactful direct quotes with brief context and why each matters.",
      },
    ],
  });
}

export async function generateBookApplyFirst(params: {
  title: string;
  author: string;
  sourceText?: string | null;
  goal?: string;
  traceId?: string;
}): Promise<{ model: string; payload: z.infer<typeof bookApplyFirstSchema> }> {
  const sourceText = normalizeSourceText(params.sourceText, 50_000);

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1100,
    schema: bookApplyFirstSchema,
    messages: [
      {
        role: "system",
        content: baseSystemJsonInstruction(
          "{ topActions: { action: string, why: string, firstStep: string }[] }"
        ),
      },
      {
        role: "user",
        content:
          buildContext({ title: params.title, author: params.author, sourceText, goal: params.goal }) +
          "\n\nTask: Recommend 3–5 prioritized actions the user should apply first, each with a why and a concrete first step.",
      },
    ],
  });
}

export async function generateBookRecommendations(params: {
  title: string;
  author: string;
  sourceText?: string | null;
  candidates: Array<{
    id: string;
    title: string;
    author: string | null;
    description: string | null;
  }>;
  traceId?: string;
}): Promise<{ model: string; payload: z.infer<typeof bookRecommendationsSchema> }> {
  const sourceText = normalizeSourceText(params.sourceText, 30_000);
  const candidates = (params.candidates || []).slice(0, 12).map((c) => ({
    id: c.id,
    title: truncate(c.title, 180),
    author: c.author ? truncate(c.author, 140) : null,
    description: c.description ? truncate(c.description, 320) : null,
  }));

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1400,
    schema: bookRecommendationsSchema,
    messages: [
      {
        role: "system",
        content: baseSystemJsonInstructionFromInputs(
          "{ recommendations: { id?: string, title: string, author?: string|null, reason: string, similarityTags: string[], whatToCompare: string[] }[], note?: string }"
        ),
      },
      {
        role: "user",
        content:
          buildContext({ title: params.title, author: params.author, sourceText }) +
          `\n\nCANDIDATE BOOKS (choose only from these if any are provided):\n${JSON.stringify(
            candidates,
            null,
            2
          )}` +
          "\n\nTask: Recommend 4–8 books. For each, provide a short reason, 0–10 similarity tags (short phrases), and 0–10 'what to compare' prompts.\nConstraints:\n- If candidate list is non-empty, ONLY recommend from that list. Use the matching 'id' when possible.\n- If candidate list is empty, recommend plausible similar books but keep reasons generic and avoid fabricated specifics.\n- No markdown; JSON only.",
      },
    ],
  });
}

export async function generateBookAuthorBackground(params: {
  title: string;
  author: string;
  sourceText?: string | null;
  authorBooks: Array<{ id: string; title: string; description: string | null }>;
  traceId?: string;
}): Promise<{ model: string; payload: z.infer<typeof bookAuthorBackgroundSchema> }> {
  const sourceText = normalizeSourceText(params.sourceText, 30_000);
  const authorBooks = (params.authorBooks || []).slice(0, 12).map((b) => ({
    id: b.id,
    title: truncate(b.title, 180),
    description: b.description ? truncate(b.description, 260) : null,
  }));

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1400,
    schema: bookAuthorBackgroundSchema,
    messages: [
      {
        role: "system",
        content: baseSystemJsonInstructionFromInputs(
          "{ authorSnapshot: string, commonThemes: string[], suggestedNextReads: { id?: string, title: string, why: string }[], note?: string }"
        ),
      },
      {
        role: "user",
        content:
          buildContext({ title: params.title, author: params.author, sourceText }) +
          `\n\nOTHER BOOKS BY THIS AUTHOR (if any):\n${JSON.stringify(authorBooks, null, 2)}` +
          "\n\nTask: Write a short author background snapshot, extract 3–12 common themes, and suggest up to 6 next reads.\nConstraints:\n- If the list of other books is provided, prefer suggesting next reads from that list (use matching 'id' when possible).\n- Avoid specific biographical claims unless strongly implied by the inputs; keep it cautious if uncertain.\n- No markdown; JSON only.",
      },
    ],
  });
}

export async function generateBookCompare(params: {
  bookATitle: string;
  bookAAuthor: string;
  bookASourceText?: string | null;
  bookBTitle: string;
  bookBAuthor: string;
  bookBSourceText?: string | null;
  traceId?: string;
}): Promise<{ model: string; payload: z.infer<typeof bookCompareSchema> }> {
  const aText = normalizeSourceText(params.bookASourceText, 30_000);
  const bText = normalizeSourceText(params.bookBSourceText, 30_000);

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1600,
    schema: bookCompareSchema,
    messages: [
      {
        role: "system",
        content: baseSystemJsonInstructionFromInputs(
          "{ similarities: string[], differences: { dimension: string, bookA: string, bookB: string }[], whoShouldReadWhich: string, ifReadingBoth: string }"
        ),
      },
      {
        role: "user",
        content:
          `BOOK A\nTitle: ${params.bookATitle}\nAuthor: ${params.bookAAuthor}\n\nSOURCE TEXT A:\n${aText ?? "(none provided)"}` +
          `\n\nBOOK B\nTitle: ${params.bookBTitle}\nAuthor: ${params.bookBAuthor}\n\nSOURCE TEXT B:\n${bText ?? "(none provided)"}` +
          "\n\nTask: Compare the two books based on the provided source texts. Provide 3–12 similarities, 3–12 differences across clear dimensions, plus advice on who should read which and a suggestion if reading both.\nNo markdown; JSON only.",
      },
    ],
  });
}
