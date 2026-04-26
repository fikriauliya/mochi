import * as React from "react";
import {
  Scribe,
  RealtimeEvents,
  CommitStrategy,
  type RealtimeConnection,
} from "@elevenlabs/client";
import { getRealtimeToken } from "./api";

/**
 * ElevenLabs Scribe v2 Realtime over WebSocket. The browser opens the
 * WS directly using a single-use token minted by `/api/voice/token`,
 * so the API key stays on the server. Scribe handles the audio capture
 * (mic acquisition, 16-bit PCM at 16kHz, base64 framing) and runs VAD
 * server-side — partial transcripts arrive every ~150ms while the user
 * speaks; a `committed_transcript` fires when they pause.
 *
 * Hook signature is preserved so KidShell doesn't change. `silenceMs`
 * maps to Scribe's `vadSilenceThresholdSecs` (range 0.3–3.0s).
 *
 * On any failure (token mint, mic permission, WS error) the hook lands
 * in `state: "error"` with an empty transcript — the UI can fall back
 * to the type-instead path.
 */

export type SpeechLang = "id-ID" | "en-US";

export const SPEECH_LANG_LABELS: Record<SpeechLang, string> = {
  "id-ID": "ID",
  "en-US": "EN",
};

type RecState = "idle" | "connecting" | "listening" | "denied" | "error";

export type UseSpeechOptions = {
  lang: SpeechLang;
  /** Called once Scribe commits a finalized segment of speech. */
  onFinal?: (text: string) => void;
  /**
   * VAD silence threshold (Scribe's `vadSilenceThresholdSecs`). The
   * server commits a segment after this many seconds of silence.
   * Range: 0.3–3.0. @default 1.5
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

/** BCP-47 (`id-ID`) → ISO 639-1 (`id`), the format Scribe accepts. */
function bcp47ToScribe(lang: SpeechLang): string {
  return lang.split("-")[0] ?? "";
}

const SUPPORTED =
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices &&
  typeof WebSocket !== "undefined";

export function useSpeech(opts: UseSpeechOptions): UseSpeechReturn {
  const { lang, onFinal, silenceMs = 1500 } = opts;
  const [state, setState] = React.useState<RecState>("idle");
  const [transcript, setTranscript] = React.useState("");

  const connectionRef = React.useRef<RealtimeConnection | null>(null);
  const onFinalRef = React.useRef(onFinal);
  const langRef = React.useRef(lang);
  const silenceMsRef = React.useRef(silenceMs);
  React.useEffect(() => {
    onFinalRef.current = onFinal;
    langRef.current = lang;
    silenceMsRef.current = silenceMs;
  });

  const start = React.useCallback(async () => {
    if (connectionRef.current) return;
    setState("connecting");
    setTranscript("");

    let token: string;
    try {
      token = await getRealtimeToken();
    } catch (err) {
      console.error("voice token mint failed", err);
      setState("error");
      return;
    }

    let conn: RealtimeConnection;
    try {
      conn = Scribe.connect({
        token,
        modelId: "scribe_v2_realtime",
        commitStrategy: CommitStrategy.VAD,
        // Scribe accepts ISO 639-1 (`id`) or 639-3 (`ind`); strip the
        // BCP-47 region tag and pass the language root.
        languageCode: bcp47ToScribe(langRef.current),
        // Clamp to Scribe's allowed range (0.3–3.0s).
        vadSilenceThresholdSecs: Math.max(
          0.3,
          Math.min(3.0, silenceMsRef.current / 1000),
        ),
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.error("Scribe.connect failed", err);
      setState("error");
      return;
    }
    connectionRef.current = conn;

    conn.on(RealtimeEvents.OPEN, () => {
      setState("listening");
    });
    conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
      setTranscript(data.text);
    });
    conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
      const text = data.text.trim();
      if (text) {
        setTranscript(text);
        onFinalRef.current?.(text);
      }
      // Auto-close after the first commit so the parent overlay flips
      // to its review phase. Re-open on "Add more" by calling start()
      // again — that mints a fresh token for a new session.
      try {
        conn.close();
      } catch {
        /* already closing */
      }
    });
    conn.on(RealtimeEvents.AUTH_ERROR, () => {
      console.error("Scribe auth error");
      setState("denied");
    });
    conn.on(RealtimeEvents.ERROR, (err) => {
      console.error("Scribe error", err);
      setState("error");
    });
    conn.on(RealtimeEvents.CLOSE, () => {
      connectionRef.current = null;
      setState((s) =>
        s === "listening" || s === "connecting" ? "idle" : s,
      );
    });
  }, []);

  const stop = React.useCallback(() => {
    const conn = connectionRef.current;
    if (!conn) return;
    try {
      conn.close();
    } catch {
      /* already closing */
    }
  }, []);

  React.useEffect(
    () => () => {
      try {
        connectionRef.current?.close();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return { supported: SUPPORTED, state, transcript, start, stop };
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
