import type { SpeechLang } from "./speech";

/**
 * ElevenLabs TTS via the Mochi server (`POST /api/voice/tts`). Returns
 * an MP3 the browser plays through a single shared <audio> element so
 * consecutive calls cancel the prior utterance instead of overlapping.
 *
 * Falls back silently if anything goes wrong — Mochi shouldn't break
 * because the API key is missing or the network is flaky.
 *
 * `lang` is accepted for API compatibility with the previous Web Speech
 * implementation; ElevenLabs `eleven_turbo_v2_5` is multilingual and
 * detects the language from the text itself.
 */

let audioEl: HTMLAudioElement | null = null;
let activeUrl: string | null = null;
let activeAbort: AbortController | null = null;

function ensureAudioEl(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

function cleanupActive(): void {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  if (activeUrl) {
    URL.revokeObjectURL(activeUrl);
    activeUrl = null;
  }
}

export function speak(text: string, _lang: SpeechLang = "id-ID"): void {
  void _lang; // accepted for compat; turbo_v2_5 is multilingual
  const trimmed = text.trim();
  if (!trimmed) return;
  const el = ensureAudioEl();
  if (!el) return;

  cleanupActive();
  try {
    el.pause();
  } catch {
    /* ignore */
  }

  const ctrl = new AbortController();
  activeAbort = ctrl;
  fetch("/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: trimmed }),
    signal: ctrl.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      const blob = await res.blob();
      // If a newer call has already started, drop this one.
      if (ctrl.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      activeUrl = url;
      el.src = url;
      // Some browsers require a user-gesture for playback; failures here
      // are common on the very first call before any tap, so swallow.
      el.play().catch(() => {
        /* autoplay blocked */
      });
    })
    .catch((err) => {
      if (ctrl.signal.aborted) return;
      console.warn("speak failed", err);
    });
}

export function cancelSpeech(): void {
  cleanupActive();
  if (audioEl) {
    try {
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
    } catch {
      /* ignore */
    }
  }
}
