import { z } from "zod";
import { OpenRouterGenerationError, OpenRouterHttpError } from "./openrouter";

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

const DEFAULT_FREE_MODELS = [
  "qwen/qwen3.6-plus-preview:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

function logPrefix(traceId?: string) {
  return traceId ? `[openrouter:language:${traceId}]` : "[openrouter:language]";
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

const courseLessonSchema = z.object({
  title: z.string().trim().min(3).max(120),
  objective: z.string().trim().min(10).max(700),
});

const coursePlanSchema = z.object({
  courseTitle: z.string().trim().min(3).max(255),
  lessons: z.array(courseLessonSchema).min(3).max(30),
});

export interface GenerateLanguageCoursePlanParams {
  targetLanguageCode: string;
  level?: string;
  lessonCount: number;
  traceId?: string;
}

export interface GeneratedLanguageCoursePlan {
  model: string;
  courseTitle: string;
  lessons: Array<{ title: string; objective: string }>;
}

const vocabItemSchema = z.object({
  term: z.string().trim().min(1).max(120),
  translation: z.string().trim().min(1).max(180),
  partOfSpeech: z.string().trim().max(60).optional(),
  targetExample: z.string().trim().max(300).optional(),
  nativeExample: z.string().trim().max(300).optional(),
});

const vocabPayloadSchema = z
  .object({
    vocab: z.array(vocabItemSchema).min(5).max(30),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const item of value.vocab) {
      const key = item.term.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate vocab term returned",
        });
        return;
      }
      seen.add(key);
    }
  });

export interface GenerateLessonVocabParams {
  targetLanguageCode: string;
  level?: string;
  lessonTitle: string;
  lessonObjective?: string;
  vocabCount: number;
  traceId?: string;
}

export interface GeneratedLessonVocab {
  model: string;
  vocab: Array<{
    term: string;
    translation: string;
    partOfSpeech?: string;
    targetExample?: string;
    nativeExample?: string;
  }>;
}

function languageNameFromCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (normalized.startsWith("es")) return "Spanish";
  if (normalized.startsWith("fr")) return "French";
  if (normalized.startsWith("de")) return "German";
  if (normalized.startsWith("it")) return "Italian";
  if (normalized.startsWith("pt")) return "Portuguese";
  if (normalized.startsWith("nl")) return "Dutch";
  return code.trim();
}

function buildCoursePlanMessages(
  targetLanguageCode: string,
  level: string,
  lessonCount: number
) {
  const languageName = languageNameFromCode(targetLanguageCode);

  return [
    {
      role: "system",
      content:
        "You are an expert language tutor. Return ONLY valid JSON (no markdown, no code fences). Keep content safe for all ages: no sexual content, hate, violence, politics, or medical/legal advice.",
    },
    {
      role: "user",
      content: `Create a minimal Duolingo-style course plan for English speakers learning ${languageName}.\nTarget language code/tag: ${targetLanguageCode}\nLevel: ${level}\nReturn JSON with this exact shape: { courseTitle: string, lessons: [{ title: string, objective: string }] }.\nConstraints:\n- Provide exactly ${lessonCount} lessons.\n- Lesson titles and objectives should be in English.\n- Objectives must be 1–2 short sentences.\n- Topics must be everyday beginner topics (greetings, numbers, food, travel, daily routine, etc.).\n- Avoid culturally sensitive or controversial topics.\n- JSON only.`,
    },
  ];
}

function buildLessonVocabMessages(
  targetLanguageCode: string,
  level: string,
  lessonTitle: string,
  lessonObjective: string | undefined,
  vocabCount: number
) {
  const languageName = languageNameFromCode(targetLanguageCode);
  const objectiveText = lessonObjective?.trim()
    ? `\nLesson objective: ${lessonObjective.trim()}`
    : "";

  return [
    {
      role: "system",
      content:
        "You are an expert language tutor. Return ONLY valid JSON (no markdown, no code fences). Keep content safe for all ages: no sexual content, hate, violence, politics, or medical/legal advice.",
    },
    {
      role: "user",
      content: `Create a vocabulary list for English speakers learning ${languageName}.\nTarget language code/tag: ${targetLanguageCode}\nLevel: ${level}\nLesson title: ${lessonTitle}${objectiveText}\nReturn JSON with this exact shape: { vocab: [{ term: string, translation: string, partOfSpeech?: string, targetExample?: string, nativeExample?: string }] }.\nConstraints:\n- Provide exactly ${vocabCount} vocab items.\n- term must be in the TARGET language.\n- translation must be in English.\n- Examples must be short and beginner-friendly.\n- Avoid slang, profanity, and sensitive topics.\n- Prefer concrete everyday words/phrases.\n- JSON only.`,
    },
  ];
}

async function callOpenRouterJson<T>(
  apiKey: string,
  model: string,
  traceId: string | undefined,
  messages: Array<{ role: string; content: string }>,
  schema: z.ZodType<T>,
  maxTokens: number
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    logDebug(traceId, "request.start", {
      url: OPENROUTER_URL,
      model,
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
          messages,
          response_format: { type: "json_object" },
          stream: false,
          temperature: 0.4,
          max_tokens: maxTokens,
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
        throw new Error(`OpenRouter request timed out after ${GENERATION_TIMEOUT_MS}ms`);
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

    logDebug(traceId, "request.response", {
      model,
      status: response.status,
      durationMs: headersDurationMs,
      openRouterRequestId,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryAfterSeconds = parseRetryAfterSeconds(
        response.headers.get("retry-after")
      );
      logError(traceId, "request.http_error", {
        model,
        status: response.status,
        openRouterRequestId,
        retryAfterSeconds,
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
    try {
      payload = (await response.json()) as OpenRouterResponse;
    } catch (error) {
      const details = formatUnknownError(error);
      const errorText = await responseClone.text().catch(() => "");
      logError(traceId, "response.json_decode_failed", {
        model,
        openRouterRequestId,
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
        openRouterRequestId,
        contentType: Array.isArray(content) ? "array" : typeof content,
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

    try {
      return schema.parse(parsed);
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
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateLanguageCoursePlanWithOpenRouter(
  params: GenerateLanguageCoursePlanParams
): Promise<GeneratedLanguageCoursePlan> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const traceId = params.traceId;

  if (!apiKey) {
    logError(traceId, "config.missing_api_key", {
      hasOpenRouterModels: Boolean(process.env.OPENROUTER_MODELS?.trim()),
      hasOpenRouterModel: Boolean(process.env.OPENROUTER_MODEL?.trim()),
    });
    throw new OpenRouterGenerationError("OPENROUTER_API_KEY is not configured", []);
  }

  const level = params.level?.trim() || "A1";
  const lessonCount = Math.min(Math.max(3, Math.floor(params.lessonCount)), 30);

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
        buildCoursePlanMessages(params.targetLanguageCode, level, lessonCount),
        coursePlanSchema,
        1200
      );

      if (payload.lessons.length !== lessonCount) {
        throw new Error(
          `Course plan returned ${payload.lessons.length} lessons (expected ${lessonCount})`
        );
      }

      return {
        model,
        courseTitle: payload.courseTitle,
        lessons: payload.lessons,
      };
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

export async function generateLessonVocabWithOpenRouter(
  params: GenerateLessonVocabParams
): Promise<GeneratedLessonVocab> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const traceId = params.traceId;

  if (!apiKey) {
    logError(traceId, "config.missing_api_key", {
      hasOpenRouterModels: Boolean(process.env.OPENROUTER_MODELS?.trim()),
      hasOpenRouterModel: Boolean(process.env.OPENROUTER_MODEL?.trim()),
    });
    throw new OpenRouterGenerationError("OPENROUTER_API_KEY is not configured", []);
  }

  const level = params.level?.trim() || "A1";
  const vocabCount = Math.min(Math.max(5, Math.floor(params.vocabCount)), 30);

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
        buildLessonVocabMessages(
          params.targetLanguageCode,
          level,
          params.lessonTitle,
          params.lessonObjective,
          vocabCount
        ),
        vocabPayloadSchema,
        1400
      );

      if (payload.vocab.length !== vocabCount) {
        throw new Error(
          `Lesson vocab returned ${payload.vocab.length} items (expected ${vocabCount})`
        );
      }

      return {
        model,
        vocab: payload.vocab,
      };
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
