import * as React from "react";

/**
 * STT used to live here as a `useSpeech` hook around ElevenLabs Scribe
 * v2 Realtime — that path was deleted when both create and modify
 * voice intake moved to the Conversational AI agent (`KidPMOverlay`).
 * What remains is the persisted UI language preference shared between
 * the home chip, the agent's per-session language override, and the
 * narrator's output.
 */

export type SpeechLang = "id-ID" | "en-US";

export const SPEECH_LANG_LABELS: Record<SpeechLang, string> = {
  "id-ID": "ID",
  "en-US": "EN",
};

const LANG_STORAGE_KEY = "mochi:speech:lang";

export function useSpeechLang(): [SpeechLang, (next: SpeechLang) => void] {
  const [lang, setLang] = React.useState<SpeechLang>(() => {
    if (typeof window === "undefined") return "id-ID";
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    return stored === "en-US" || stored === "id-ID" ? stored : "id-ID";
  });

  const update = React.useCallback((next: SpeechLang) => {
    setLang(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // private mode
    }
  }, []);

  return [lang, update];
}
