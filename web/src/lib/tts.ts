export type TtsVoicePreference = {
  voiceURI: string;
  name: string;
  lang: string;
};

const STORAGE_KEY = "speedread_tts_voice_prefs_v1";

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
  const normalizedLang = (languageCode || "").trim().toLowerCase();
  if (!normalizedLang) return null;

  const baseLang = normalizedLang.split("-")[0];

  return (
    voices.find((v) => v.lang?.toLowerCase() === normalizedLang) ||
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

  return (
    voices.find((v) => v.voiceURI === uri) ||
    voices.find((v) => v.name === name && v.lang === preferred.lang) ||
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

  try {
    synth.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = params.languageCode;

    if (typeof params.rate === "number") utter.rate = params.rate;
    if (typeof params.pitch === "number") utter.pitch = params.pitch;
    if (typeof params.volume === "number") utter.volume = params.volume;

    const voices = synth.getVoices();

    const chosen =
      pickPreferredVoice(voices, params.preferredVoice) ||
      pickAutoVoice(voices, params.languageCode);

    if (chosen) {
      utter.voice = chosen;
      // When a specific voice is chosen, align the utterance language with it.
      // This helps some browsers pick the right phonemes/pronunciation.
      if (chosen.lang) {
        utter.lang = chosen.lang;
      }
    }

    synth.speak(utter);
  } catch {
    // no-op
  }
}
