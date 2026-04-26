import * as React from "react";

/**
 * MediaRecorder + ElevenLabs `scribe_v1` STT, proxied through the Mochi
 * server (`POST /api/voice/transcribe`). Replaces the old browser Web
 * Speech API path so transcription quality is consistent across iPad
 * Safari, Android WebView, Chrome, etc.
 *
 * Trade-off vs the previous webkitSpeechRecognition flow: no live interim
 * transcripts. We capture audio for one utterance, auto-stop when the user
 * pauses (RMS-based VAD on an AnalyserNode), POST the audio, and emit the
 * final text via `onFinal` once the server responds.
 *
 * The hook signature is preserved so KidShell doesn't change.
 */
export type SpeechLang = "id-ID" | "en-US";

export const SPEECH_LANG_LABELS: Record<SpeechLang, string> = {
  "id-ID": "ID",
  "en-US": "EN",
};

type RecState = "idle" | "listening" | "transcribing" | "denied" | "error";

export type UseSpeechOptions = {
  lang: SpeechLang;
  /** Called once the server returns a transcript. */
  onFinal?: (text: string) => void;
  /**
   * Stop recording after this many ms of silence following the most recent
   * loud frame. The VAD only arms once at least one loud frame has been
   * detected, so a slow start to speaking doesn't kill the recording.
   * Set to 0 to disable auto-stop (caller must invoke `stop()`).
   *
   * 2000ms tolerates natural mid-thought pauses (kids especially);
   * shorter values were cutting off short utterances after every
   * inter-word gap.
   * @default 2000
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

const RMS_THRESHOLD = 0.025; // ≈ -32 dBFS — quiet room is well below this

/** Pick a MediaRecorder mime type that's widely supported. */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

export function useSpeech(opts: UseSpeechOptions): UseSpeechReturn {
  const { lang, onFinal, silenceMs = 2000 } = opts;
  const [supported, setSupported] = React.useState(false);
  const [state, setState] = React.useState<RecState>("idle");
  const [transcript, setTranscript] = React.useState("");

  // Mutable session state stays in refs so a re-render mid-recording doesn't
  // restart the MediaRecorder.
  const sessionRef = React.useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    audioCtx: AudioContext;
    rafId: number | null;
    chunks: Blob[];
  } | null>(null);
  const submitAbortRef = React.useRef<AbortController | null>(null);
  const onFinalRef = React.useRef(onFinal);
  const silenceMsRef = React.useRef(silenceMs);
  const langRef = React.useRef(lang);
  React.useEffect(() => {
    onFinalRef.current = onFinal;
    silenceMsRef.current = silenceMs;
    langRef.current = lang;
  });

  React.useEffect(() => {
    const ok =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      typeof MediaRecorder !== "undefined" &&
      pickMimeType() !== "";
    setSupported(ok);
  }, []);

  const teardown = React.useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    if (s.rafId !== null) cancelAnimationFrame(s.rafId);
    try {
      s.audioCtx.close();
    } catch {
      /* ignore */
    }
    for (const track of s.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const submit = React.useCallback(
    async (audio: Blob) => {
      submitAbortRef.current?.abort();
      const ctrl = new AbortController();
      submitAbortRef.current = ctrl;
      setState("transcribing");
      try {
        const url = `/api/voice/transcribe?lang=${encodeURIComponent(langRef.current)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": audio.type || "audio/webm" },
          body: audio,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        if (!res.ok) throw new Error(`server ${res.status}`);
        const data = (await res.json()) as { text?: string };
        if (ctrl.signal.aborted) return;
        const text = (data.text ?? "").trim();
        setTranscript(text);
        if (text) onFinalRef.current?.(text);
        setState("idle");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.error("transcribe failed", err);
        setState("error");
      } finally {
        if (submitAbortRef.current === ctrl) submitAbortRef.current = null;
      }
    },
    [],
  );

  const start = React.useCallback(async () => {
    if (sessionRef.current) return; // already recording
    const mimeType = pickMimeType();
    if (!mimeType) {
      setState("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.fftSize);
    const chunks: Blob[] = [];

    let lastLoudAt = performance.now();
    let everSpoke = false;
    let rafId: number | null = null;

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const v = ((buffer[i] ?? 128) - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      if (rms > RMS_THRESHOLD) {
        lastLoudAt = performance.now();
        everSpoke = true;
      }
      const ms = silenceMsRef.current;
      if (everSpoke && ms > 0 && performance.now() - lastLoudAt > ms) {
        try {
          recorder.stop();
        } catch {
          /* already stopping */
        }
        return;
      }
      rafId = requestAnimationFrame(tick);
      if (sessionRef.current) sessionRef.current.rafId = rafId;
    };

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      teardown();
      setState("error");
    };
    recorder.onstop = () => {
      teardown();
      const audio = new Blob(chunks, { type: mimeType });
      // No bytes captured → either the user didn't speak, the mic was
      // muted by the OS, or the encoder produced nothing. Surface as
      // "error" so the overlay can show a "didn't catch that" hint
      // instead of silently flipping back to idle with no transcript.
      if (audio.size === 0) {
        setState("error");
        return;
      }
      void submit(audio);
    };

    sessionRef.current = { recorder, stream, audioCtx, rafId: null, chunks };
    setTranscript("");
    setState("listening");
    recorder.start(100);
    rafId = requestAnimationFrame(tick);
    sessionRef.current.rafId = rafId;
  }, [submit, teardown]);

  const stop = React.useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      s.recorder.stop();
    } catch {
      /* already stopping → onstop will fire */
    }
  }, []);

  React.useEffect(
    () => () => {
      const s = sessionRef.current;
      if (s) {
        try {
          s.recorder.stop();
        } catch {
          /* ignore */
        }
        teardown();
      }
      submitAbortRef.current?.abort();
    },
    [teardown],
  );

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
