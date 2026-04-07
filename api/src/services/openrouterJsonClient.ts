import { z } from "zod";
import { OpenRouterHttpError } from "./openrouter";

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

const DEFAULT_FREE_MODELS = [
  "qwen/qwen3.6-plus-preview:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

export type OpenRouterLogFn = (
  traceId: string | undefined,
  message: string,
  meta?: Record<string, unknown>
) => void;

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

export function parseModelsFromEnv(): string[] {
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

  if (rawModels) {
    const parsed = parse(rawModels);
    return parsed.length > 0 ? parsed : DEFAULT_FREE_MODELS;
  }

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

export async function callOpenRouterJson<T>(
  apiKey: string,
  model: string,
  traceId: string | undefined,
  messages: Array<{ role: string; content: string }>,
  schema: z.ZodType<T>,
  maxTokens: number,
  options?: {
    temperature?: number;
    logDebug?: OpenRouterLogFn;
    logError?: OpenRouterLogFn;
  }
): Promise<T> {
  const logDebug = options?.logDebug;
  const logError = options?.logError;
  const temperature = options?.temperature ?? 0.4;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    logDebug?.(traceId, "request.start", {
      url: OPENROUTER_URL,
      model,
      timeoutMs: GENERATION_TIMEOUT_MS,
      maxTokens,
      temperature,
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
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const details = formatUnknownError(error);

      if (isAbortError(error)) {
        logError?.(traceId, "request.timeout", {
          model,
          durationMs,
          timeoutMs: GENERATION_TIMEOUT_MS,
          ...details,
        });
        throw new Error(`OpenRouter request timed out after ${GENERATION_TIMEOUT_MS}ms`);
      }

      logError?.(traceId, "request.fetch_failed", {
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

    logDebug?.(traceId, "request.response", {
      model,
      status: response.status,
      durationMs: headersDurationMs,
      openRouterRequestId,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));

      logError?.(traceId, "request.http_error", {
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

      logError?.(traceId, "response.json_decode_failed", {
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
      logError?.(traceId, "response.invalid_content", {
        model,
        openRouterRequestId,
        contentType: Array.isArray(content) ? "array" : typeof content,
      });
      throw new Error(
        `Model returned an empty or non-string response${openRouterRequestId ? ` (${openRouterRequestId})` : ""}`
      );
    }

    logDebug?.(traceId, "response.content_snippet", {
      model,
      snippet: normalizeSnippet(content, 600),
    });

    let parsed: unknown;
    try {
      parsed = extractJsonContent(content);
    } catch (error) {
      const details = formatUnknownError(error);
      logError?.(traceId, "response.json_parse_failed", {
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

      logError?.(traceId, "response.schema_validation_failed", {
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
