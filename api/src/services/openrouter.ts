import { z } from "zod";

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";
const GENERATION_TIMEOUT_MS = 25_000;
const MIN_PASSAGE_WORDS = 120;

const DEFAULT_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
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

  constructor(message: string, attemptedModels: string[]) {
    super(message);
    this.name = "OpenRouterGenerationError";
    this.attemptedModels = attemptedModels;
  }
}

function wordCount(input: string): number {
  return input
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0).length;
}

function parseModelsFromEnv(): string[] {
  const rawModels = process.env.OPENROUTER_MODELS;
  if (!rawModels) {
    return DEFAULT_FREE_MODELS;
  }

  const parsed = rawModels
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  return parsed.length > 0 ? parsed : DEFAULT_FREE_MODELS;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
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
        temperature: 0.7,
        max_tokens: 2200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errorText.slice(0, 280)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("Model returned an empty response");
    }

    const parsed = extractJsonContent(content);
    const validated = generatedPayloadSchema.parse(parsed);

    const words = wordCount(validated.content);
    if (words < MIN_PASSAGE_WORDS) {
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

  if (!apiKey) {
    throw new OpenRouterGenerationError(
      "OPENROUTER_API_KEY is not configured",
      []
    );
  }

  const models = parseModelsFromEnv();
  const attempted: string[] = [];
  let lastError = "Unknown generation error";

  for (const model of models) {
    attempted.push(model);

    try {
      const generated = await callModel(apiKey, model, params);
      return {
        model,
        ...generated,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new OpenRouterGenerationError(
    `OpenRouter generation failed: ${lastError}`,
    attempted
  );
}
