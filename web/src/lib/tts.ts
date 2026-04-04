export type TtsVoicePreference = {
  voiceURI: string;
  name: string;
  lang: string;
};

const STORAGE_KEY = "speedread_tts_voice_prefs_v1";

let speakRequestSeq = 0;

function queueMicrotaskSafe(fn: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn);
    return;
  }
  Promise.resolve()
    .then(fn)
    .catch(() => {
      // no-op
    });
}

function normalizeLangTag(code: string): string {
  return (code || "").trim().replace(/_/g, "-");
}

export function getLanguageVoiceKey(languageCode: string): string {
  const raw = (languageCode || "").trim().toLowerCase();
  if (!raw) return "";
  const [base] = raw.split("-");
  return (base || raw).trim();
}

export function loadTtsVoicePrefs(): Record<string, TtsVoicePreference> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const out: Record<string, TtsVoicePreference> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || typeof value !== "object" || value === null) continue;

      const v = value as Partial<TtsVoicePreference>;
      if (
        typeof v.voiceURI === "string" &&
        typeof v.name === "string" &&
        typeof v.lang === "string" &&
        v.voiceURI.trim().length > 0
      ) {
        out[key.toLowerCase()] = {
          voiceURI: v.voiceURI,
          name: v.name,
          lang: v.lang,
        };
      }
    }

    return out;
  } catch {
    return {};
  }
}

export function saveTtsVoicePrefs(prefs: Record<string, TtsVoicePreference>): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // no-op
  }
}

export function isBrowserTtsSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

export function listSpeechSynthesisVoices(): SpeechSynthesisVoice[] {
  if (!isBrowserTtsSupported()) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
}

function pickAutoVoice(
  voices: SpeechSynthesisVoice[],
  languageCode: string
): SpeechSynthesisVoice | null {
  const normalizedLang = normalizeLangTag(languageCode).toLowerCase();
  if (!normalizedLang) return null;

  const baseLang = normalizedLang.split("-")[0];

  return (
    voices.find((v) => v.lang?.toLowerCase() === normalizedLang) ||
    voices.find((v) => v.lang?.toLowerCase() === baseLang) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(`${baseLang}-`)) ||
    null
  );
}

function pickPreferredVoice(
  voices: SpeechSynthesisVoice[],
  preferred: TtsVoicePreference | null | undefined
): SpeechSynthesisVoice | null {
  if (!preferred) return null;

  const uri = preferred.voiceURI.trim();
  const name = preferred.name.trim();
  const preferredLang = normalizeLangTag(preferred.lang).toLowerCase();

  return (
    voices.find((v) => v.voiceURI === uri) ||
    voices.find(
      (v) => v.name === name && normalizeLangTag(v.lang).toLowerCase() === preferredLang
    ) ||
    voices.find((v) => v.name === name) ||
    null
  );
}

export function speakTextWithTts(params: {
  text: string;
  languageCode: string;
  preferredVoice?: TtsVoicePreference | null;
  rate?: number;
  pitch?: number;
  volume?: number;
}): void {
  if (!isBrowserTtsSupported()) return;

  const text = (params.text || "").trim();
  if (!text) return;

  const synth = window.speechSynthesis;
  const requestSeq = ++speakRequestSeq;

  try {
    const utter = new SpeechSynthesisUtterance(text);
    const normalizedLang = normalizeLangTag(params.languageCode);
    utter.lang = normalizedLang || params.languageCode;

    if (typeof params.rate === "number") utter.rate = params.rate;
    if (typeof params.pitch === "number") utter.pitch = params.pitch;
    if (typeof params.volume === "number") utter.volume = params.volume;

    // Some mobile browsers can end up paused.
    try {
      synth.resume();
    } catch {
      // ignore
    }

    const voices = (() => {
      try {
        return synth.getVoices() || [];
      } catch {
        return [] as SpeechSynthesisVoice[];
      }
    })();

    const chosen =
      pickPreferredVoice(voices, params.preferredVoice) ||
      pickAutoVoice(voices, params.languageCode);

    if (chosen) {
      utter.voice = chosen;
      // When a specific voice is chosen, align the utterance language with it.
      // This helps some browsers pick the right phonemes/pronunciation.
      if (chosen.lang) {
        const chosenLang = normalizeLangTag(chosen.lang);
        utter.lang = chosenLang || chosen.lang;
      }
    }

    const doSpeak = () => {
      if (requestSeq !== speakRequestSeq) return;
      try {
        synth.resume();
      } catch {
        // ignore
      }
      synth.speak(utter);
    };

    // Avoid cancel() unless something is already playing/queued.
    // Some browsers can drop the next utterance if cancel() and speak() happen
    // back-to-back in the same tick.
    const needsCancel = (() => {
      try {
        return synth.speaking || synth.pending;
      } catch {
        return false;
      }
    })();

    if (needsCancel) {
      try {
        synth.cancel();
      } catch {
        // ignore
      }
      queueMicrotaskSafe(doSpeak);
      return;
    }

    doSpeak();
  } catch {
    // no-op
  }
}
