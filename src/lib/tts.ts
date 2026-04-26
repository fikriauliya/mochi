import type { SpeechLang } from "./speech";
import { isAbortError } from "./utils";

/**
 * The DOMException message used as the abort reason when speech is
 * cancelled. Imported by `frontend.tsx`'s window-level rejection
 * handler so that extension-induced "Uncaught (in promise) AbortError"
 * noise from this specific abort is suppressed; everything else still
 * surfaces.
 */
export const SPEECH_ABORT_REASON = "speech cancelled";

/**
 * Streaming TTS via ElevenLabs (proxied through `/api/voice/tts`).
 *
 * The server pipes ElevenLabs' streaming MP3 response straight through;
 * the browser feeds it into a `MediaSource` `SourceBuffer` and starts
 * playback as soon as a couple hundred ms of audio is buffered, rather
 * than waiting for the full ~2 s generation.
 *
 * Falls back silently to a buffered Blob playback if `MediaSource` (or
 * `audio/mpeg` SourceBuffer support) isn't available — older Safari +
 * iOS WebView path. Falls back further to a no-op if the fetch fails.
 *
 * `lang` is accepted for API-compat with the previous Web Speech path;
 * `eleven_turbo_v2_5` is multilingual and detects the language from
 * the text itself.
 */

let audioEl: HTMLAudioElement | null = null;
let activeAbort: AbortController | null = null;
let activeUrl: string | null = null;

function ensureAudioEl(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

function clearActive(): void {
  if (activeAbort) {
    // Explicit reason so any awaiter that surfaces signal.reason gets
    // a clear message instead of the default "signal is aborted
    // without reason". Matched by frontend.tsx's rejection filter.
    activeAbort.abort(new DOMException(SPEECH_ABORT_REASON, "AbortError"));
    activeAbort = null;
  }
  if (activeUrl) {
    try {
      URL.revokeObjectURL(activeUrl);
    } catch {
      /* ignore */
    }
    activeUrl = null;
  }
  // Detach the audio element from whatever MediaSource we had attached
  // so it (and its SourceBuffer) becomes eligible for GC. Back-to-back
  // speak() calls leak one MediaSource each without this.
  if (audioEl) {
    try {
      audioEl.removeAttribute("src");
      audioEl.load();
    } catch {
      /* ignore */
    }
  }
}

const canStream =
  typeof MediaSource !== "undefined" &&
  typeof MediaSource.isTypeSupported === "function" &&
  MediaSource.isTypeSupported("audio/mpeg");

export function speak(text: string, _lang: SpeechLang = "id-ID"): void {
  void _lang; // accepted for compat; turbo_v2_5 is multilingual
  const trimmed = text.trim();
  if (!trimmed) return;
  const el = ensureAudioEl();
  if (!el) return;

  clearActive();
  try {
    el.pause();
  } catch {
    /* ignore */
  }
  const ctrl = new AbortController();
  activeAbort = ctrl;
  // play() awaits multiple abortable resources (fetch, reader,
  // MediaSource sourceopen). Catch outside the inner try/catches so
  // the strict-mode cleanup doesn't surface an "unhandled rejection".
  play(el, trimmed, ctrl).catch((err) => {
    if (isAbortError(err)) return;
    console.warn("speak failed", err);
  });
}

async function play(
  el: HTMLAudioElement,
  text: string,
  ctrl: AbortController,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (!ctrl.signal.aborted) console.warn("speak fetch failed", err);
    return;
  }
  if (ctrl.signal.aborted) return;
  if (!res.ok || !res.body) {
    console.warn(`speak failed: TTS ${res.status}`);
    return;
  }

  if (!canStream) {
    // No MediaSource support — fall back to buffered playback.
    const blob = await res.blob();
    if (ctrl.signal.aborted) return;
    const url = URL.createObjectURL(blob);
    activeUrl = url;
    el.src = url;
    el.play().catch(() => {
      /* autoplay blocked */
    });
    return;
  }

  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);
  activeUrl = url;
  el.src = url;

  await new Promise<void>((resolve) => {
    if (ms.readyState === "open") {
      resolve();
      return;
    }
    ms.addEventListener("sourceopen", () => resolve(), { once: true });
  });
  if (ctrl.signal.aborted) return;

  const sb = ms.addSourceBuffer("audio/mpeg");
  const queue: Uint8Array[] = [];
  let started = false;
  let endRequested = false;

  const drain = () => {
    if (sb.updating || queue.length === 0) return;
    const chunk = queue.shift();
    if (!chunk) return;
    try {
      sb.appendBuffer(chunk);
    } catch (err) {
      console.warn("appendBuffer failed", err);
    }
  };

  sb.addEventListener("updateend", () => {
    drain();
    // Kick off playback once we have a hair of buffered audio. ~100ms
    // is enough to hide the next-chunk arrival and feels instant.
    if (
      !started &&
      sb.buffered.length > 0 &&
      sb.buffered.end(0) > 0.1
    ) {
      started = true;
      el.play().catch(() => {
        /* autoplay blocked */
      });
    }
    if (
      endRequested &&
      queue.length === 0 &&
      !sb.updating &&
      ms.readyState === "open"
    ) {
      try {
        ms.endOfStream();
      } catch {
        /* already ended */
      }
    }
  });

  const reader = res.body.getReader();
  try {
    while (true) {
      if (ctrl.signal.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      queue.push(value);
      drain();
    }
  } catch (err) {
    if (!ctrl.signal.aborted) console.warn("speak stream read failed", err);
    return;
  }

  endRequested = true;
  // Trigger one more drain so an idle SourceBuffer doesn't sit on the
  // last chunk forever.
  drain();
  if (
    !sb.updating &&
    queue.length === 0 &&
    ms.readyState === "open"
  ) {
    try {
      ms.endOfStream();
    } catch {
      /* already ended */
    }
  }
}

export function cancelSpeech(): void {
  clearActive();
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      /* ignore */
    }
  }
}
