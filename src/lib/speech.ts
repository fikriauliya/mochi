import * as React from "react";

// Minimal local types for Web Speech (lib.dom doesn't ship these everywhere).
type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResult = {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
  length: number;
};
type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult | undefined;
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};
type SpeechRecognitionErrorEvent = { error: string };

/**
 * Thin React hook around the browser's Web Speech API
 * (`webkitSpeechRecognition` / `SpeechRecognition`).
 *
 * - Continuous = false: ends after the user pauses
 * - Interim results: transcript updates live as the user speaks
 * - Errors and unsupported browsers surface as `supported: false`
 *
 * The actual transcription happens in the browser (Chrome / Edge / Android
 * WebView ship with a Google-cloud-backed implementation; Safari uses Apple's).
 */
export type SpeechLang = "id-ID" | "en-US";

export const SPEECH_LANG_LABELS: Record<SpeechLang, string> = {
  "id-ID": "ID",
  "en-US": "EN",
};

type RecState = "idle" | "listening" | "denied" | "error";

type AnyRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type AnyRecognitionCtor = new () => AnyRecognition;

function getRecognitionCtor(): AnyRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: AnyRecognitionCtor;
    webkitSpeechRecognition?: AnyRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type UseSpeechOptions = {
  lang: SpeechLang;
  /** Called whenever the transcript updates (interim or final). */
  onTranscript?: (text: string, isFinal: boolean) => void;
  /** Called once the user finishes speaking with the final text. */
  onFinal?: (text: string) => void;
  /**
   * Stop recognition after this many ms of silence following the most recent
   * transcribed word. Browsers' built-in end-of-speech detection is sluggish
   * (≈2 s in Chrome), so we close the loop ourselves. Set to 0 to disable.
   * @default 800
   */
  silenceMs?: number;
};

export type UseSpeechReturn = {
  supported: boolean;
  state: RecState;
  transcript: string;
  start: () => void;
  stop: () => void;
};

/**
 * Run a single utterance: tap start, the user talks, when they pause we hand
 * the final transcript back via `onFinal`. The hook is single-shot per call to
 * `start()`; the consumer drives subsequent recordings.
 */
export function useSpeech(opts: UseSpeechOptions): UseSpeechReturn {
  const { lang, onTranscript, onFinal, silenceMs = 800 } = opts;
  const [supported, setSupported] = React.useState(false);
  const [state, setState] = React.useState<RecState>("idle");
  const [transcript, setTranscript] = React.useState("");
  const recRef = React.useRef<AnyRecognition | null>(null);
  const silenceMsRef = React.useRef(silenceMs);

  React.useEffect(() => {
    setSupported(getRecognitionCtor() != null);
  }, []);

  React.useEffect(() => {
    silenceMsRef.current = silenceMs;
  }, [silenceMs]);

  // Latest callbacks via ref so we don't re-create the recognition object.
  const onTranscriptRef = React.useRef(onTranscript);
  const onFinalRef = React.useRef(onFinal);
  React.useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onFinalRef.current = onFinal;
  });

  const start = React.useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    // Replace any in-flight session.
    recRef.current?.abort();

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = "";
    let lastInterim = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const armSilenceTimer = () => {
      if (silenceMsRef.current <= 0) return;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        // Closing the recognition triggers `onend`, which submits whatever
        // text we've accumulated so far.
        try {
          rec.stop();
        } catch {
          /* ignore — rec may already be stopping */
        }
      }, silenceMsRef.current);
    };

    const clearSilenceTimer = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    };

    rec.onstart = () => {
      setState("listening");
      setTranscript("");
    };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result || !result[0]) continue;
        const text = result[0].transcript;
        if (result.isFinal) {
          finalText += text;
        } else {
          interim += text;
        }
      }
      lastInterim = interim;
      const display = (finalText + interim).trim();
      setTranscript(display);
      onTranscriptRef.current?.(display, false);

      // Restart the silence timer on every audible token. We only arm once we
      // have *some* content so the user can pause initially without losing it.
      if (display) armSilenceTimer();
    };
    rec.onerror = (e) => {
      clearSilenceTimer();
      const err = (e as { error?: string }).error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        setState("denied");
      } else {
        setState("error");
      }
    };
    rec.onend = () => {
      clearSilenceTimer();
      // Browsers don't always commit the latest interim as `final` when we
      // force-stop, so fall back to the last interim if final is empty.
      const cleaned = (finalText.trim() || lastInterim.trim());
      if (cleaned) {
        onTranscriptRef.current?.(cleaned, true);
        onFinalRef.current?.(cleaned);
      }
      setState((s) => (s === "listening" ? "idle" : s));
      recRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setState("error");
    }
  }, [lang]);

  const stop = React.useCallback(() => {
    recRef.current?.stop();
  }, []);

  // On unmount, kill any in-flight session.
  React.useEffect(() => () => recRef.current?.abort(), []);

  return { supported, state, transcript, start, stop };
}

const LANG_STORAGE_KEY = "mochi:speech:lang";

/** Persisted speech language preference. */
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
      // ignore — private mode
    }
  }, []);

  return [lang, update];
}
