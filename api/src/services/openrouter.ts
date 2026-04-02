import { z } from "zod";

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_GENERATION_TIMEOUT_MS = 60_000;
const GENERATION_TIMEOUT_MS = (() => {
  const raw = (process.env.OPENROUTER_TIMEOUT_MS || "").trim();
  if (!raw) return DEFAULT_GENERATION_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_GENERATION_TIMEOUT_MS;
  return Math.floor(parsed);
})();
const MIN_PASSAGE_WORDS = 120;

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
  return traceId ? `[openrouter:${traceId}]` : "[openrouter]";
}

function logDebug(traceId: string | undefined, message: string, meta?: Record<string, unknown>) {
  if (!DEBUG_OPENROUTER) return;
  if (meta) {
    console.log(logPrefix(traceId), message, meta);
    return;
  }
  console.log(logPrefix(traceId), message);
}

function logError(traceId: string | undefined, message: string, meta?: Record<string, unknown>) {
  if (meta) {
    console.error(logPrefix(traceId), message, meta);
    return;
  }
  console.error(logPrefix(traceId), message);
}

function normalizeSnippet(input: string, maxLen: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}…`;
}

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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const DEFAULT_FREE_MODELS = [
  "qwen/qwen3.6-plus-preview:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const generatedOptionSchema = z.object({
  text: z.string().trim().min(1).max(220),
  isCorrect: z.boolean(),
});

const generatedQuestionSchema = z
  .object({
    prompt: z.string().trim().min(8).max(500),
    explanation: z.string().trim().max(1200).optional(),
    options: z.array(generatedOptionSchema).length(4),
  })
  .superRefine((value, ctx) => {
    const correctCount = value.options.filter((opt) => opt.isCorrect).length;
    if (correctCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each question must have exactly one correct option",
      });
    }
  });

const generatedPayloadSchema = z.object({
  title: z.string().trim().min(5).max(500),
  content: z.string().trim().min(300),
  questions: z.array(generatedQuestionSchema).length(5),
});

export interface GenerateUnseenParams {
  theme: string;
  keywords?: string;
  traceId?: string;
}

export interface GeneratedUnseenPayload {
  model: string;
  title: string;
  content: string;
  questions: Array<{
    prompt: string;
    explanation?: string;
    options: Array<{
      text: string;
      isCorrect: boolean;
    }>;
  }>;
}

export class OpenRouterGenerationError extends Error {
  attemptedModels: string[];
  lastStatus?: number;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    attemptedModels: string[],
    meta?: { lastStatus?: number; retryAfterSeconds?: number }
  ) {
    super(message);
    this.name = "OpenRouterGenerationError";
    this.attemptedModels = attemptedModels;
    this.lastStatus = meta?.lastStatus;
    this.retryAfterSeconds = meta?.retryAfterSeconds;
  }
}

export class OpenRouterHttpError extends Error {
  status: number;
  requestId: string | null;
  retryAfterSeconds?: number;
  bodySnippet: string;

  constructor(params: {
    status: number;
    requestId: string | null;
    retryAfterSeconds?: number;
    bodySnippet: string;
  }) {
    const requestIdText = params.requestId ? ` (${params.requestId})` : "";
    super(`OpenRouter ${params.status}${requestIdText}: ${params.bodySnippet}`);
    this.name = "OpenRouterHttpError";
    this.status = params.status;
    this.requestId = params.requestId;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.bodySnippet = params.bodySnippet;
  }
}

function wordCount(input: string): number {
  return input
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0).length;
}

function parseModelsFromEnv(): string[] {
  const rawModels = (process.env.OPENROUTER_MODELS ?? "").trim();
  const rawModel = (process.env.OPENROUTER_MODEL ?? "").trim();

  const parse = (raw: string) =>
    raw
      .split(",")
      .map((model) => model.trim())
      .filter((model) => model.length > 0);

  const uniq = (models: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const model of models) {
      if (seen.has(model)) continue;
      seen.add(model);
      out.push(model);
    }
    return out;
  };

  // OPENROUTER_MODELS is treated as an explicit ordered list.
  if (rawModels) {
    const parsed = parse(rawModels);
    return parsed.length > 0 ? parsed : DEFAULT_FREE_MODELS;
  }

  // OPENROUTER_MODEL is treated as a preferred single model; if set, we still
  // fall back to the built-in free model list to reduce hard failures.
  if (rawModel) {
    const parsed = parse(rawModel);
    if (parsed.length === 0) return DEFAULT_FREE_MODELS;
    return uniq([...parsed, ...DEFAULT_FREE_MODELS]);
  }

  return DEFAULT_FREE_MODELS;
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function extractJsonContent(rawContent: string): unknown {
  const trimmed = rawContent.trim();

  const withoutFences = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(withoutFences);
  } catch {
    const firstBrace = withoutFences.indexOf("{");
    const lastBrace = withoutFences.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const probableJson = withoutFences.slice(firstBrace, lastBrace + 1);
      return JSON.parse(probableJson);
    }

    throw new Error("Unable to parse JSON from model response");
  }
}

function buildMessages(theme: string, keywords?: string) {
  const keywordText = keywords?.trim()
    ? `\nKeywords to include where relevant: ${keywords.trim()}`
    : "";

  return [
    {
      role: "system",
      content:
        "You generate unseen reading passages with MCQs. Return ONLY valid JSON with this exact shape: { title: string, content: string, questions: [{ prompt: string, explanation?: string, options: [{ text: string, isCorrect: boolean }] }] }. Use exactly 5 questions. Each question must have exactly 4 options and exactly 1 correct option.",
    },
    {
      role: "user",
      content: `Create an unseen passage and MCQs for English reading practice.\nTheme: ${theme}${keywordText}\nConstraints:\n1) Passage must be clear and realistic.\n2) Passage length 130 to 220 words.\n3) Questions should test comprehension, inference, and main idea.\n4) No markdown, no code fences, JSON only.`,
    },
  ];
}

async function callModel(
  apiKey: string,
  model: string,
  params: GenerateUnseenParams
): Promise<Omit<GeneratedUnseenPayload, "model">> {
  const traceId = params.traceId;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    logDebug(traceId, "request.start", {
      url: OPENROUTER_URL,
      model,
      hasTheme: Boolean(params.theme?.trim()),
      keywordsLength: params.keywords?.trim()?.length ?? 0,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_APP_URL || "http://localhost",
          "X-Title": process.env.OPENROUTER_APP_NAME || "Speed-Read",
        },
        body: JSON.stringify({
          model,
          messages: buildMessages(params.theme, params.keywords),
          response_format: { type: "json_object" },
          stream: false,
          temperature: 0.7,
          max_tokens: 2200,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const details = formatUnknownError(error);

      if (isAbortError(error)) {
        logError(traceId, "request.timeout", {
          model,
          durationMs,
          timeoutMs: GENERATION_TIMEOUT_MS,
          ...details,
        });
        throw new Error(
          `OpenRouter request timed out after ${GENERATION_TIMEOUT_MS}ms`
        );
      }

      logError(traceId, "request.fetch_failed", {
        model,
        durationMs,
        ...details,
      });
      throw error;
    }

    const headersDurationMs = Date.now() - startedAt;
    const openRouterRequestId =
      response.headers.get("x-openrouter-request-id") ||
      response.headers.get("x-request-id") ||
      response.headers.get("x-correlation-id");

    const contentType = response.headers.get("content-type");
    const contentLength = response.headers.get("content-length");

    logDebug(traceId, "request.response", {
      model,
      status: response.status,
      durationMs: headersDurationMs,
      openRouterRequestId,
      contentType,
      contentLength,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryAfterSeconds = parseRetryAfterSeconds(
        response.headers.get("retry-after")
      );
      logError(traceId, "request.http_error", {
        model,
        status: response.status,
        durationMs: headersDurationMs,
        openRouterRequestId,
        errorSnippet: normalizeSnippet(errorText, 2000),
      });

      throw new OpenRouterHttpError({
        status: response.status,
        requestId: openRouterRequestId,
        retryAfterSeconds,
        bodySnippet: normalizeSnippet(errorText, 280),
      });
    }

    type OpenRouterResponse = {
      choices?: Array<{
        message?: {
          content?: unknown;
        };
      }>;
    };

    const responseClone = response.clone();
    let payload: OpenRouterResponse;
    const bodyStartedAt = Date.now();
    try {
      payload = (await response.json()) as OpenRouterResponse;
    } catch (error) {
      const details = formatUnknownError(error);
      const bodyDurationMs = Date.now() - bodyStartedAt;
      const totalDurationMs = Date.now() - startedAt;

      if (isAbortError(error)) {
        logError(traceId, "response.timeout", {
          model,
          status: response.status,
          timeoutMs: GENERATION_TIMEOUT_MS,
          headersDurationMs,
          bodyDurationMs,
          totalDurationMs,
          openRouterRequestId,
          contentType,
          contentLength,
          ...details,
        });
        throw new Error(
          `OpenRouter response timed out after ${GENERATION_TIMEOUT_MS}ms${openRouterRequestId ? ` (${openRouterRequestId})` : ""}`
        );
      }

      const errorText = await responseClone.text().catch(() => "");
      logError(traceId, "response.json_decode_failed", {
        model,
        status: response.status,
        headersDurationMs,
        bodyDurationMs,
        totalDurationMs,
        openRouterRequestId,
        contentType,
        contentLength,
        errorSnippet: normalizeSnippet(errorText, 2000),
        ...details,
      });
      throw new Error(
        `OpenRouter returned invalid JSON${openRouterRequestId ? ` (${openRouterRequestId})` : ""}`
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      logError(traceId, "response.invalid_content", {
        model,
        contentType: Array.isArray(content) ? "array" : typeof content,
        openRouterRequestId,
      });
      throw new Error(
        `Model returned an empty or non-string response${openRouterRequestId ? ` (${openRouterRequestId})` : ""}`
      );
    }

    logDebug(traceId, "response.content_snippet", {
      model,
      snippet: normalizeSnippet(content, 600),
    });

    let parsed: unknown;
    try {
      parsed = extractJsonContent(content);
    } catch (error) {
      const details = formatUnknownError(error);
      logError(traceId, "response.json_parse_failed", {
        model,
        openRouterRequestId,
        contentSnippet: normalizeSnippet(content, 1200),
        ...details,
      });
      throw error;
    }

    let validated: z.infer<typeof generatedPayloadSchema>;
    try {
      validated = generatedPayloadSchema.parse(parsed);
    } catch (error) {
      const details = formatUnknownError(error);
      const issues = error instanceof z.ZodError ? error.issues : undefined;
      logError(traceId, "response.schema_validation_failed", {
        model,
        openRouterRequestId,
        issues,
        parsedType: Array.isArray(parsed) ? "array" : typeof parsed,
        ...details,
      });
      throw error;
    }

    const words = wordCount(validated.content);
    if (words < MIN_PASSAGE_WORDS) {
      logError(traceId, "response.too_short", {
        model,
        openRouterRequestId,
        words,
      });
      throw new Error(`Generated passage too short (${words} words)`);
    }

    return validated;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateUnseenWithOpenRouter(
  params: GenerateUnseenParams
): Promise<GeneratedUnseenPayload> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const traceId = params.traceId;

  if (!apiKey) {
    logError(traceId, "config.missing_api_key", {
      hasOpenRouterModels: Boolean(process.env.OPENROUTER_MODELS?.trim()),
      hasOpenRouterModel: Boolean(process.env.OPENROUTER_MODEL?.trim()),
    });
    throw new OpenRouterGenerationError(
      "OPENROUTER_API_KEY is not configured",
      []
    );
  }

  const models = parseModelsFromEnv();
  logDebug(traceId, "config.models", { models, timeoutMs: GENERATION_TIMEOUT_MS });
  const attempted: string[] = [];
  let lastError = "Unknown generation error";
  let lastStatus: number | undefined;
  let retryAfterSeconds: number | undefined;

  for (const model of models) {
    attempted.push(model);

    logDebug(traceId, "model.attempt", { model });

    try {
      const generated = await callModel(apiKey, model, params);
      return {
        model,
        ...generated,
      };
    } catch (error) {
      const details = formatUnknownError(error);
      lastError = details.message;

      if (error instanceof OpenRouterHttpError) {
        lastStatus = error.status;
        retryAfterSeconds = error.retryAfterSeconds;
      }

      logError(traceId, "model.failed", {
        model,
        ...details,
      });
    }
  }

  logError(traceId, "all_models_failed", {
    attempted,
    lastError,
  });

  throw new OpenRouterGenerationError(
    `OpenRouter generation failed: ${lastError}`,
    attempted,
    { lastStatus, retryAfterSeconds }
  );
}
