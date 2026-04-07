import { z } from "zod";
import { OpenRouterGenerationError, OpenRouterHttpError } from "./openrouter";
import { callOpenRouterJson, parseModelsFromEnv } from "./openrouterJsonClient";
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
        buildCoursePlanMessages(params.targetLanguageCode, level, lessonCount),
        coursePlanSchema,
        1200,
        { temperature: 0.4, logDebug, logError }
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
        buildLessonVocabMessages(
          params.targetLanguageCode,
          level,
          params.lessonTitle,
          params.lessonObjective,
          vocabCount
        ),
        vocabPayloadSchema,
        1400,
        { temperature: 0.4, logDebug, logError }
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
