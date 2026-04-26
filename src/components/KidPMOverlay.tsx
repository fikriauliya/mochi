import * as React from "react";
import { X, Keyboard } from "lucide-react";
import {
  Conversation,
  type Mode,
  type Role,
} from "@elevenlabs/client";
import { Mochi } from "./Mochi";
import { getAgentSignedUrl } from "@/lib/api";
import type { App, AppKind } from "@/lib/types";
import type { SpeechLang } from "@/lib/speech";

/**
 * Voice-only requirement gathering. Hands the kid off to a Conversational
 * AI agent ("Mochi PM") that asks short questions and submits the spec
 * via a `submit_requirements` client tool. The browser opens the agent's
 * WebSocket directly using a server-minted signed URL — keeps the API
 * key off the client.
 *
 * Used for both create (2-4 questions) and modify (1-2 questions). The
 * agent branches on `intent` via dynamic variables; the firstMessage
 * override greets create with "what should we make?" and modify with
 * "what should I change about <name>?".
 *
 * Cancel / mic-denied / signed-url failure all fall through to the type
 * fallback so the demo never gets stuck.
 */

type Phase = "connecting" | "talking" | "submitting" | "error";

type LatestMessage = { role: Role; text: string };

// Verbose console traces only when the family flips `mochi:verbose=1`
// (the same flag AgentLog reads). Keeps the console clean during demos
// — and importantly keeps user transcripts off the default console.
const dbg: (...args: unknown[]) => void =
  typeof window !== "undefined" &&
  window.localStorage.getItem("mochi:verbose") === "1"
    ? (...args) => console.log("[pm]", ...args)
    : () => {};

export function KidPMOverlay({
  lang,
  intent,
  outputKind,
  existingApp,
  onClose,
  onPrompt,
  onSwitchToType,
}: {
  lang: SpeechLang;
  intent: "create" | "modify";
  outputKind: AppKind;
  /** Required when intent==="modify"; ignored for create. */
  existingApp?: App;
  onClose: () => void;
  onPrompt: (spec: string) => void;
  onSwitchToType: () => void;
}) {
  const [phase, setPhase] = React.useState<Phase>("connecting");
  const [mode, setMode] = React.useState<Mode>("listening");
  const [latest, setLatest] = React.useState<LatestMessage | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");

  const conversationRef = React.useRef<Conversation | null>(null);
  const submittedRef = React.useRef(false);
  // Survive React 19 strict-mode mount→cleanup→mount: `initialisedRef`
  // dedupes the second mount; the cleanup defers teardown via setTimeout
  // so the remount clears the timer before it fires, and only a real
  // unmount tears down the in-flight Conversation handshake.
  const initialisedRef = React.useRef(false);
  const pendingTeardownRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(() => {
    if (pendingTeardownRef.current) {
      clearTimeout(pendingTeardownRef.current);
      pendingTeardownRef.current = null;
    }
    if (initialisedRef.current) return;
    initialisedRef.current = true;

    const abortController = new AbortController();

    (async () => {
      let signedUrl: string;
      try {
        signedUrl = await getAgentSignedUrl(lang);
      } catch (err) {
        if (abortController.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : "Couldn't reach the helper";
        console.warn("[pm] signed-url FAILED", err);
        setErrorMsg(msg);
        setPhase("error");
        return;
      }
      if (abortController.signal.aborted) return;

      try {
        const conv = await Conversation.startSession({
          signedUrl,
          // Belt-and-braces: the SDK aborts the in-flight handshake +
          // tears down the audio worklet when this fires. Pairs with the
          // initialisedRef guard above to prevent the strict-mode dual
          // mount from leaving an orphan WebSocket behind.
          abortController,
          dynamicVariables: {
            intent,
            output_kind: outputKind,
            existing_name: existingApp?.name ?? "",
            existing_description: existingApp?.description ?? "",
          },
          clientTools: {
            submit_requirements: ({ spec }) => {
              const trimmed = String(spec ?? "").trim();
              if (!trimmed) return "missing spec";
              if (submittedRef.current) return "already submitted";
              submittedRef.current = true;
              setPhase("submitting");
              // End the conversation synchronously so the agent's voice
              // stops before the build view's "Mochi is making it!" TTS
              // starts — otherwise the two overlap and the kid hears
              // two Mochis at once.
              conversationRef.current?.endSession().catch(() => {});
              onPrompt(trimmed);
              return "submitted";
            },
          },
          onConnect: ({ conversationId }) => {
            dbg("onConnect", conversationId);
            setPhase("talking");
          },
          onDisconnect: (details) => dbg("onDisconnect", details),
          onStatusChange: ({ status }) => dbg("onStatusChange", status),
          onModeChange: ({ mode: m }) => {
            dbg("onModeChange", m);
            setMode(m);
          },
          onMessage: ({ message, role }) => {
            dbg("onMessage", role, message);
            const text = message.trim();
            if (!text) return;
            setLatest({ role, text });
          },
          onError: (msg, ctx) => {
            console.warn("[pm] onError", msg, ctx);
            if (!submittedRef.current) {
              setErrorMsg(typeof msg === "string" ? msg : "Connection error");
              setPhase("error");
            }
          },
        });
        if (abortController.signal.aborted) {
          await conv.endSession().catch(() => {});
          return;
        }
        conversationRef.current = conv;
      } catch (err) {
        if (abortController.signal.aborted) return;
        console.warn("[pm] startSession FAILED", err);
        setErrorMsg(
          err instanceof Error ? err.message : "Connection failed",
        );
        setPhase("error");
      }
    })();

    return () => {
      pendingTeardownRef.current = setTimeout(() => {
        pendingTeardownRef.current = null;
        abortController.abort();
        const conv = conversationRef.current;
        if (conv) {
          conv.endSession().catch(() => {});
          conversationRef.current = null;
        }
        initialisedRef.current = false;
      }, 30);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headline = (() => {
    if (phase === "connecting") return "Hi! It's Mochi…";
    if (phase === "submitting") {
      return intent === "modify"
        ? "Got it, fixing it now!"
        : "Awesome, making it now!";
    }
    if (phase === "error") {
      return lang === "id-ID"
        ? "Aduh, ada masalah."
        : "Oh no, something went wrong.";
    }
    if (latest) return latest.text;
    if (intent === "modify" && existingApp) {
      return `What should I change about ${existingApp.name}?`;
    }
    return outputKind === "printable"
      ? "Tell me what to print…"
      : "Tell me what to make…";
  })();

  const subline = (() => {
    if (phase === "connecting") return "warming up the kitchen";
    if (phase === "submitting") return "sending it to the build team";
    if (phase === "error") return errorMsg || "tap below to type instead";
    if (!latest) return "Mochi is listening";
    return latest.role === "user" ? "you said" : "Mochi";
  })();

  return (
    <div className="fixed inset-0 z-50 bg-cream/95 backdrop-blur-md flex flex-col items-center justify-center p-6">
      <button
        onClick={onClose}
        aria-label="Cancel"
        className="
          absolute top-4 right-4 size-12 2xl:size-14 rounded-full
          bg-paper border border-line flex items-center justify-center
          text-ink-soft hover:bg-cream-deep transition-colors
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
        "
      >
        <X className="size-5 2xl:size-6" />
      </button>

      <Mochi
        typing={phase === "talking" && mode === "listening"}
        happy={
          phase === "submitting" ||
          (phase === "talking" && mode === "speaking")
        }
        size={200}
      />

      <p className="mt-6 text-ink-faint italic text-sm 2xl:text-base">
        {subline}
      </p>

      <h2
        className="font-display text-3xl sm:text-5xl lg:text-6xl 2xl:text-7xl text-ink mt-3 text-center max-w-3xl 2xl:max-w-4xl leading-tight"
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
      >
        {headline}
      </h2>

      {phase === "error" && (
        <button
          onClick={onSwitchToType}
          autoFocus
          className="
            mt-8 inline-flex items-center gap-2
            min-h-14 2xl:min-h-16 px-6 rounded-full
            bg-mochi-deep text-paper font-bold text-lg 2xl:text-2xl
            shadow-[0_8px_20px_-8px_rgba(224,114,107,0.7)]
            hover:scale-[1.02] active:scale-95 transition-transform
            focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
          "
        >
          <Keyboard className="size-5 2xl:size-6" />
          Type instead
        </button>
      )}
    </div>
  );
}
