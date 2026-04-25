import type { SpeechLang } from "./speech";

/**
 * Tiny wrapper around `window.speechSynthesis`. Cancels any in-flight speech
 * before starting the new utterance so consecutive calls don't pile up.
 *
 * Falls back silently if the browser has no SpeechSynthesis.
 */
export function speak(text: string, lang: SpeechLang = "id-ID"): void {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;

  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1;
    u.pitch = 1.05;
    u.volume = 1;
    synth.speak(u);
  } catch {
    // ignore — some browsers throw if called before user interaction
  }
}

export function cancelSpeech(): void {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
}
