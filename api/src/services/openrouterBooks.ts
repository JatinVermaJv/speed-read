import { z } from "zod";
import { OpenRouterGenerationError, OpenRouterHttpError } from "./openrouter";
import {
  callOpenRouterJson,
  parseModelsFromEnv,
  type OpenRouterLogFn,
} from "./openrouterJsonClient";
import { filterModelsForCooldown, markModelRateLimited } from "./openrouterModelCooldown";

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
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: typeof error, message: String(error) };
}

function sanitizeSourceText(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return input.slice(0, maxChars);
}

// BUG FIX: original `generateBookQuoteExtraction` called truncate before
// sanitizeSourceText, meaning HTML tags counted toward the char limit and
// the sanitized result could be shorter than intended. Always sanitize first.
function normalizeSourceText(
  value: string | null | undefined,
  maxChars: number
): string | null {
  if (typeof value !== "string") return null;
  const sanitized = sanitizeSourceText(value);
  if (!sanitized) return null;
  return truncate(sanitized, maxChars);
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

function bulletsToParagraph(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .filter((v) => typeof v === "string")
    .map((v) => (v as string).trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

const headingSummarySectionSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const obj = raw as Record<string, unknown>;

    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    if (summary) return raw;

    const derived = bulletsToParagraph(obj.bullets);
    if (derived) return { ...obj, summary: derived };

    return raw;
  },
  z.object({
    heading: z.string().trim(),
    summary: z.string().trim(),
  })
);

const bookSummaryTldrSchema = z.object({
  tldr: z.string().trim(),
});

const bookSummaryConciseSchema = z.object({
  summary: z.string().trim(),
});

const bookSummaryDeepSchema = z.object({
  overview: z.string().trim(),
  sections: z.array(headingSummarySectionSchema),
});

const bookSummarySkimmableSchema = z.object({
  headline: z.string().trim(),
  sections: z.array(headingSummarySectionSchema),
});

const bookTakeawaysThemesSchema = z.object({
  themes: z.array(z.string().trim()),
  takeaways: z.array(z.string().trim()),
});

const bookPhilosophicalAnglesSchema = z.object({
  angles: z.array(
    z.object({
      lens: z.string().trim(),
      angle: z.string().trim(),
    })
  ),
  questions: z.array(z.string().trim()),
});

const bookQuoteExtractionSchema = z.object({
  quotes: z.array(
    z.object({
      quote: z.string().trim(),
      context: z.string().trim(),
      whyItMatters: z.string().trim(),
    })
  ),
  note: z.string().trim().optional(),
});

const bookApplyFirstSchema = z.object({
  topActions: z.array(
    z.object({
      action: z.string().trim(),
      why: z.string().trim(),
      firstStep: z.string().trim(),
    })
  ),
});

const bookRecommendationsSchema = z.object({
  recommendations: z.array(
    z.object({
      id: z.string().trim().optional(),
      title: z.string().trim(),
      author: z.string().trim().nullable().optional(),
      reason: z.string().trim(),
      similarityTags: z.array(z.string().trim()).default([]),
      whatToCompare: z.array(z.string().trim()).default([]),
    })
  ),
  note: z.string().trim().optional(),
});

const bookAuthorBackgroundSchema = z.object({
  authorSnapshot: z.string().trim(),
  commonThemes: z.array(z.string().trim()),
  suggestedNextReads: z
    .array(
      z.object({
        id: z.string().trim().optional(),
        title: z.string().trim(),
        why: z.string().trim(),
      })
    )
    .default([]),
  note: z.string().trim().optional(),
});

const bookCompareSchema = z.object({
  similarities: z.array(z.string().trim()),
  differences: z.array(
    z.object({
      dimension: z.string().trim(),
      bookA: z.string().trim(),
      bookB: z.string().trim(),
    })
  ),
  whoShouldReadWhich: z.string().trim(),
  ifReadingBoth: z.string().trim(),
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

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Shared rules injected into every system prompt.
 * Kept short deliberately — each function adds task-specific rules.
 */
const SHARED_RULES = `\
Rules:
- Return ONLY valid JSON. No markdown, no code fences, no preamble.
- Always return the complete JSON shape — never refuse or truncate fields.
- If SOURCE TEXT is provided, ground your answer in it; do not contradict it.
- If SOURCE TEXT is absent, rely only on the book title and author; use hedged language ("likely", "often", "may").
- Paraphrase and synthesise — do not reproduce verbatim passages. Avoid quotation marks unless the task explicitly asks for quotes extracted from SOURCE TEXT.
- Never invent direct quotes or bibliographic facts you cannot verify.
- Language must be suitable for all ages.`;

/**
 * System prompt for tasks that work from book context alone.
 */
function systemPrompt(shapeHint: string, extraRules?: string): string {
  const extra = extraRules ? `\n${extraRules}` : "";
  return `You are an expert literary analyst and reading coach. Return ONLY valid JSON matching this exact shape: ${shapeHint}\n\n${SHARED_RULES}${extra}`;
}

/**
 * System prompt for tasks that must stay within supplied candidate lists
 * (recommendations, author books, etc.).
 */
function systemPromptFromInputs(shapeHint: string, extraRules?: string): string {
  const extra = extraRules ? `\n${extraRules}` : "";
  return `You are an expert literary analyst and reading coach. Return ONLY valid JSON matching this exact shape: ${shapeHint}\n\n${SHARED_RULES}
- Use ONLY the provided inputs (book context + candidate lists). Do not introduce books or facts not present in the inputs.${extra}`;
}

/**
 * Builds the user-turn context block shared across most tasks.
 */
function buildContext(params: {
  title: string;
  author: string;
  sourceText?: string | null;
  goal?: string;
}): string {
  const goalLine = params.goal?.trim() ? `\nReader goal: ${params.goal.trim()}` : "";
  const sourceBlock = params.sourceText
    ? `SOURCE TEXT:\n${params.sourceText}`
    : "SOURCE TEXT: (none provided — use only book title and author)";
  return `Book: "${params.title}" by ${params.author}${goalLine}\n\n${sourceBlock}`;
}

// ---------------------------------------------------------------------------
// Model execution
// ---------------------------------------------------------------------------

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

  const allModels = parseModelsFromEnv();
  const models = filterModelsForCooldown(allModels);

  if (models.length !== allModels.length) {
    logDebug(traceId, "config.models.cooldown_filtered", { allModels, models });
  }

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
        if (error.status === 429) {
          markModelRateLimited(model, error.retryAfterSeconds);
        }
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateBookSummary(params: {
  kind: BookSummaryKind;
  title: string;
  author: string;
  sourceText?: string | null;
  traceId?: string;
}): Promise<{ model: string; payload: BookAiPayload }> {
  const sourceText = normalizeSourceText(params.sourceText, 50_000);
  const ctx = buildContext({ title: params.title, author: params.author, sourceText });

  if (params.kind === "tldr") {
    return generateWithModels({
      traceId: params.traceId,
      maxTokens: 600,
      temperature: 0.25,
      schema: bookSummaryTldrSchema,
      messages: [
        {
          role: "system",
          content: systemPrompt(
            "{ tldr: string }",
            "- tldr: 1–3 punchy sentences capturing the book's core argument or story — what it is really about, not just its topic.\n- Do NOT use bullet points, numbered lists, or headings inside the text. Write as plain paragraphs."
          ),
        },
        {
          role: "user",
          content: `${ctx}\n\nTask: Write a TLDR that captures the book's core argument or narrative drive in 1–3 sentences. Write it as plain text (no bullet points, no numbered lists).`,
        },
      ],
    });
  }

  if (params.kind === "concise") {
    return generateWithModels({
      traceId: params.traceId,
      maxTokens: 1100,
      temperature: 0.35,
      schema: bookSummaryConciseSchema,
      messages: [
        {
          role: "system",
          content: systemPrompt(
            "{ summary: string }",
            "- summary: 2–4 paragraphs. Open with the book's central thesis or situation, develop the key arc or argument, and close with what the book ultimately delivers or leaves the reader with.\n- Do NOT use bullet points, numbered lists, or headings inside the text."
          ),
        },
        {
          role: "user",
          content: `${ctx}\n\nTask: Produce a concise summary (2–4 paragraphs) that conveys the book's argument, development, and payoff — not just what it covers. Use plain paragraphs only (no bullets, no numbered lists).`,
        },
      ],
    });
  }

  if (params.kind === "deep") {
    return generateWithModels({
      traceId: params.traceId,
      maxTokens: 1800,
      temperature: 0.55,
      schema: bookSummaryDeepSchema,
      messages: [
        {
          role: "system",
          content: systemPrompt(
            "{ overview: string, sections: { heading: string, summary: string }[] }",
            "- overview: A substantial opening that situates the book — its core argument or story, why it was written, and what makes it significant.\n- sections: 3–10 thematic sections (not chapter numbers). Each heading should name a genuine idea or tension, not a topic. Each summary should be 1 short paragraph explaining the section's argument and why it matters.\n- Do NOT use bullet points or numbered lists anywhere."
          ),
        },
        {
          role: "user",
          content: `${ctx}\n\nTask: Write a deep, analytical summary. Start with a substantial overview covering the book's core argument, context, and significance. Then develop 3–10 thematic sections — each exploring an idea, tension, or turning point in depth. Write everything as paragraphs only (no bullets, no numbered lists).`,
        },
      ],
    });
  }

  // skimmable
  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1500,
    temperature: 0.4,
    schema: bookSummarySkimmableSchema,
    messages: [
      {
        role: "system",
        content: systemPrompt(
          "{ headline: string, sections: { heading: string, summary: string }[] }",
          "- headline: One sentence — the book's single most important idea.\n- sections: 4–12 sections. Each heading should be a crisp phrase that names a concept or argument. Each summary should be 1 short paragraph the reader can scan quickly.\n- Do NOT use bullet points or numbered lists anywhere."
        ),
      },
      {
        role: "user",
        content: `${ctx}\n\nTask: Create a skimmable outline. Lead with a one-sentence headline capturing the book's single most important idea. Then build 4–12 sections — each with a sharp heading and a short paragraph that makes the section's argument clear at a glance. Do not use bullets.`,
      },
    ],
  });
}

export async function generateBookTakeawaysThemes(params: {
  title: string;
  author: string;
  sourceText?: string | null;
  traceId?: string;
}): Promise<{ model: string; payload: z.infer<typeof bookTakeawaysThemesSchema> }> {
  const sourceText = normalizeSourceText(params.sourceText, 50_000);
  const ctx = buildContext({ title: params.title, author: params.author, sourceText });

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1100,
    temperature: 0.55,
    schema: bookTakeawaysThemesSchema,
    messages: [
      {
        role: "system",
        content: systemPrompt(
          "{ themes: string[], takeaways: string[] }",
          "- themes: 3–10 recurring ideas, tensions, or preoccupations that run through the book — name each as a concept or short phrase (e.g. 'the cost of certainty', 'institutional inertia').\n- takeaways: 5–12 items. Write each as a complete, opinionated sentence the reader can directly use or argue against — not a vague observation."
        ),
      },
      {
        role: "user",
        content: `${ctx}\n\nTask: Identify 3–10 core themes — the deep preoccupations and tensions that run through this book, named as sharp concepts. Then extract 5–12 takeaways: each should be a complete, concrete sentence that a reader can write on a sticky note, apply to their own life or work, or push back on. Prioritise insight over coverage.`,
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
  const ctx = buildContext({ title: params.title, author: params.author, sourceText });

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1200,
    temperature: 0.75,
    schema: bookPhilosophicalAnglesSchema,
    messages: [
      {
        role: "system",
        content: systemPrompt(
          "{ angles: { lens: string, angle: string }[], questions: string[] }",
          "- angles: 3–8 items. Each 'lens' is a named philosophical tradition, school, or framework (e.g. 'Stoicism', 'Feminist ethics', 'Pragmatism'). Each 'angle' explains what that lens reveals or challenges about the book's central ideas — be specific, not generic.\n- questions: 3–10 open questions for post-reading reflection. Make them genuinely hard to answer — the kind that linger."
        ),
      },
      {
        role: "user",
        content: `${ctx}\n\nTask: Analyse this book through 3–8 distinct philosophical lenses. For each, name the tradition or framework and explain — concretely — what it illuminates, complicates, or challenges in the book. Then pose 3–10 reflection questions that push the reader beyond the text: questions worth sitting with, not ones the book already answers.`,
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
  // Sanitize before truncating so HTML tags don't consume the char budget.
  const sourceText = truncate(sanitizeSourceText(params.sourceText), 50_000);

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 900,
    temperature: 0.2,
    schema: bookQuoteExtractionSchema,
    messages: [
      {
        role: "system",
        content: systemPrompt(
          "{ quotes: { quote: string, context: string, whyItMatters: string }[], note?: string }",
          "- ONLY include quotes that appear verbatim in SOURCE TEXT. Never invent or reconstruct quotes.\n- If there are no quotable passages, return quotes: [] and a short, honest note explaining why.\n- context: one sentence placing the quote in the book's narrative or argument.\n- whyItMatters: one sentence on why this quote is worth returning to — what it crystallises, challenges, or reveals."
        ),
      },
      {
        role: "user",
        content: `${buildContext({ title: params.title, author: params.author, sourceText })}\n\nTask: Extract up to 12 passages that appear verbatim in the SOURCE TEXT and are worth returning to: lines that crystallise a key idea, carry emotional weight, or reveal something essential about the author's thinking. For each, give a one-sentence context and a one-sentence explanation of why it matters.`,
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
  const ctx = buildContext({ title: params.title, author: params.author, sourceText, goal: params.goal });

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1100,
    temperature: 0.65,
    schema: bookApplyFirstSchema,
    messages: [
      {
        role: "system",
        content: systemPrompt(
          "{ topActions: { action: string, why: string, firstStep: string }[] }",
          "- topActions: 3–5 items, ranked by impact — highest leverage first.\n- action: a specific, ownable behaviour change — not a vague intention.\n- why: the mechanism: why this action produces a meaningful result based on the book's ideas.\n- firstStep: the smallest concrete move the reader can take today to begin this action — no abstract advice."
        ),
      },
      {
        role: "user",
        content: `${ctx}\n\nTask: Identify the 3–5 highest-leverage actions a reader should take first after finishing this book. Rank them by impact. For each: name a specific, concrete behaviour (not a platitude); explain the mechanism — why it works, grounded in the book's ideas; then give the smallest possible first step someone can take today. If the reader has stated a goal, bias the recommendations toward it.`,
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
  const ctx = buildContext({ title: params.title, author: params.author, sourceText });

  const candidates = (params.candidates || []).slice(0, 12).map((c) => ({
    id: c.id,
    title: truncate(c.title, 180),
    author: c.author ? truncate(c.author, 140) : null,
    description: c.description ? truncate(c.description, 320) : null,
  }));

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1400,
    temperature: 0.55,
    schema: bookRecommendationsSchema,
    messages: [
      {
        role: "system",
        content: systemPromptFromInputs(
          "{ recommendations: { id?: string, title: string, author?: string|null, reason: string, similarityTags: string[], whatToCompare: string[] }[], note?: string }",
          "\n- reason: explain the specific intellectual or emotional connection to the current book — not just 'similar themes'. Name what the reader will gain that the current book didn't give them, or how it extends/challenges it.\n- similarityTags: 0–10 short phrases naming shared concepts, styles, or audiences.\n- whatToCompare: 0–10 specific prompts inviting the reader to contrast the two books on a concrete dimension."
        ),
      },
      {
        role: "user",
        content: `${ctx}\n\nCANDIDATE BOOKS (select only from this list if non-empty):\n${JSON.stringify(candidates, null, 2)}\n\nTask: Recommend 4–8 books. For each, write a reason that goes beyond 'similar themes' — explain the specific intellectual connection, what the reader gains that the current book didn't provide, or how it pushes back on it. Include 0–10 similarity tags and 0–10 concrete comparison prompts.\nConstraints: if candidates are provided, select only from that list and use the matching 'id'. If the list is empty, suggest plausible books but keep claims general.`,
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
  const ctx = buildContext({ title: params.title, author: params.author, sourceText });

  const authorBooks = (params.authorBooks || []).slice(0, 12).map((b) => ({
    id: b.id,
    title: truncate(b.title, 180),
    description: b.description ? truncate(b.description, 260) : null,
  }));

  return generateWithModels({
    traceId: params.traceId,
    maxTokens: 1400,
    temperature: 0.4,
    schema: bookAuthorBackgroundSchema,
    messages: [
      {
        role: "system",
        content: systemPromptFromInputs(
          "{ authorSnapshot: string, commonThemes: string[], suggestedNextReads: { id?: string, title: string, why: string }[], note?: string }",
          "\n- authorSnapshot: 2–4 sentences covering the author's perspective, voice, and what distinguishes their body of work — grounded only in the provided inputs.\n- commonThemes: 3–12 recurring preoccupations across the author's work — phrase each as a concept, not a description.\n- suggestedNextReads: up to 6 books from the provided list. For each, explain specifically how it extends, deepens, or contrasts with the current book."
        ),
      },
      {
        role: "user",
        content: `${ctx}\n\nOTHER BOOKS BY THIS AUTHOR:\n${JSON.stringify(authorBooks, null, 2)}\n\nTask: Write a 2–4 sentence author snapshot that conveys their distinctive perspective and voice — grounded in the inputs, not invented. Identify 3–12 recurring themes across their work. Suggest up to 6 next reads from the provided list, explaining for each why someone who loved this book should read it next.`,
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
    temperature: 0.35,
    schema: bookCompareSchema,
    messages: [
      {
        role: "system",
        content: systemPromptFromInputs(
          "{ similarities: string[], differences: { dimension: string, bookA: string, bookB: string }[], whoShouldReadWhich: string, ifReadingBoth: string }",
          "\n- similarities: 3–12 items. Each should name a specific shared idea, approach, or concern — not just 'both are about leadership'.\n- differences: 3–12 items. Each 'dimension' should be a meaningful axis of comparison (e.g. 'tone', 'proposed solution', 'scope of argument'). bookA and bookB explain each book's position on that dimension in concrete terms.\n- whoShouldReadWhich: a nuanced recommendation that helps a reader choose based on their situation or goal — not 'read both'.\n- ifReadingBoth: a concrete suggestion for how to sequence or connect them to get the most out of reading both."
        ),
      },
      {
        role: "user",
        content: `BOOK A: "${params.bookATitle}" by ${params.bookAAuthor}\nSOURCE TEXT A:\n${aText ?? "(none)"}\n\nBOOK B: "${params.bookBTitle}" by ${params.bookBAuthor}\nSOURCE TEXT B:\n${bText ?? "(none)"}\n\nTask: Compare the two books analytically. Identify 3–12 specific similarities — shared ideas or preoccupations, not surface-level genre tags. Contrast them across 3–12 meaningful dimensions, describing each book's distinct position. Then give clear, nuanced guidance: who should choose which book and why, and — if someone reads both — how to sequence or connect them for maximum insight.`,
      },
    ],
  });
}