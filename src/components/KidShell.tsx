import * as React from "react";
import {
  Mic,
  ArrowLeft,
  X,
  ExternalLink,
  Pencil,
  RefreshCcw,
  Trash2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Mochi } from "./Mochi";
import { AgentLog } from "./AgentLog";
import {
  SPEECH_LANG_LABELS,
  type SpeechLang,
  useSpeech,
  useSpeechLang,
} from "@/lib/speech";
import { speak, cancelSpeech } from "@/lib/tts";
import { deleteApp, subscribeStream } from "@/lib/api";
import type { App, BuildEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The only UI for Mochi. Same view-state machine as before:
 *   - Home: giant mic + suggestion chips + tile grid of family apps
 *   - Build: mascot + status + collapsible "Watch Mochi work" + retry on error
 *   - Open: full iframe + chunky back button
 *
 * Tap a tile to play. Long-press a tile to open the app menu (modify by voice,
 * delete, open in a real tab, see the description).
 *
 * Visible copy is English; speech recognition + TTS follow the speech-lang
 * setting (default Indonesian, toggleable via the corner chip).
 */

type View =
  | { kind: "home" }
  | { kind: "build"; appId: string }
  | { kind: "open"; appId: string };

const SUGGESTIONS = [
  "a flashcard quiz about animals",
  "a tap-the-color game",
  "a checklist for the morning",
  "a dinosaur sticker board",
  "a counting game with apples",
];

type ShellProps = {
  apps: App[];
  view: View;
  currentApp: App | null;
  onCreate: (prompt: string) => void;
  onModify: (id: string, prompt: string) => void;
  onOpenApp: (id: string) => void;
  onBack: () => void;
  onReload: () => void;
  onBuildDone: (id: string) => void;
};

export function KidShell(props: ShellProps) {
  const {
    apps,
    view,
    currentApp,
    onCreate,
    onModify,
    onOpenApp,
    onBack,
    onReload,
    onBuildDone,
  } = props;

  if (view.kind === "open" && currentApp) {
    return <KidOpenView app={currentApp} onBack={onBack} />;
  }
  if (view.kind === "build" && currentApp) {
    return (
      <KidBuildView
        app={currentApp}
        onBack={onBack}
        onDone={onBuildDone}
        onRetry={onModify}
      />
    );
  }
  return (
    <KidHome
      apps={apps}
      onOpenApp={onOpenApp}
      onCreate={onCreate}
      onModify={onModify}
      onReload={onReload}
    />
  );
}

/* ---- shared bits ---- */

function LangChip({
  lang,
  setLang,
  className,
}: {
  lang: SpeechLang;
  setLang: (next: SpeechLang) => void;
  className?: string;
}) {
  return (
    <button
      onClick={() => setLang(lang === "id-ID" ? "en-US" : "id-ID")}
      title="Speech language"
      className={cn(
        "px-3 py-1.5 rounded-full text-[0.7rem] font-bold uppercase tracking-[0.18em]",
        "bg-paper border border-line text-ink-soft",
        "hover:bg-cream-deep transition-colors",
        className,
      )}
    >
      🎙 {SPEECH_LANG_LABELS[lang]}
    </button>
  );
}

/* -------------------------------- Home -------------------------------- */

function KidHome(props: {
  apps: App[];
  onOpenApp: (id: string) => void;
  onCreate: (prompt: string) => void;
  onModify: (id: string, prompt: string) => void;
  onReload: () => void;
}) {
  const { apps, onOpenApp, onCreate, onModify, onReload } = props;
  const [lang, setLang] = useSpeechLang();
  type Voice =
    | { kind: "idle" }
    | { kind: "create" }
    | { kind: "modify"; app: App };
  const [voice, setVoice] = React.useState<Voice>({ kind: "idle" });
  const [menuApp, setMenuApp] = React.useState<App | null>(null);

  // newest first; show all statuses
  const sorted = [...apps].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="h-dvh w-screen bg-cream flex flex-col overflow-hidden">
      <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
        <LangChip lang={lang} setLang={setLang} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <button
          onClick={() => setVoice({ kind: "create" })}
          aria-label="Tap to talk"
          className="
            relative inline-flex items-center justify-center
            size-44 sm:size-52 lg:size-60 rounded-full
            bg-mochi-deep text-paper
            shadow-[0_18px_40px_-12px_rgba(224,114,107,0.7)]
            hover:scale-[1.04] active:scale-95 transition-transform
            focus:outline-none focus:ring-8 focus:ring-mochi-soft
          "
        >
          <span className="absolute inset-0 rounded-full bg-mochi-deep mic-halo" />
          <Mic className="size-20 sm:size-24 lg:size-28 relative" strokeWidth={2} />
        </button>
        <p
          className="font-display text-2xl sm:text-3xl lg:text-4xl text-ink-soft italic text-center"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
        >
          Tap &amp; talk
        </p>

        {/* Suggestion chips */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-2xl">
          <span className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint mr-1">
            try
          </span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onCreate(s)}
              className="
                px-3 py-1.5 rounded-full text-[0.78rem] italic
                bg-paper border border-line/70 text-ink-soft
                hover:bg-cream-deep transition-colors
              "
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-6 sm:pb-8">
        <h2 className="text-[0.78rem] uppercase tracking-[0.22em] text-ink-faint text-center mb-3">
          Your stuff
        </h2>
        {sorted.length === 0 ? (
          <p className="text-center text-ink-faint italic">
            No apps yet — tap the mic to make one!
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 max-w-5xl mx-auto">
            {sorted.slice(0, 12).map((app) => (
              <KidAppTile
                key={app.id}
                app={app}
                onOpen={onOpenApp}
                onLongPress={() => setMenuApp(app)}
              />
            ))}
          </div>
        )}
      </div>

      {voice.kind !== "idle" && (
        <KidMicOverlay
          lang={lang}
          intent={voice.kind}
          onClose={() => setVoice({ kind: "idle" })}
          onPrompt={(prompt) => {
            const v = voice;
            setVoice({ kind: "idle" });
            if (v.kind === "create") onCreate(prompt);
            else if (v.kind === "modify") onModify(v.app.id, prompt);
          }}
        />
      )}

      {menuApp && (
        <KidAppMenu
          app={menuApp}
          onClose={() => setMenuApp(null)}
          onOpen={(id) => {
            setMenuApp(null);
            onOpenApp(id);
          }}
          onModify={(app) => {
            setMenuApp(null);
            setVoice({ kind: "modify", app });
          }}
          onDelete={async (id) => {
            try {
              await deleteApp(id);
              setMenuApp(null);
              onReload();
            } catch (e) {
              console.error("delete failed", e);
            }
          }}
        />
      )}
    </div>
  );
}

function KidAppTile({
  app,
  onOpen,
  onLongPress,
}: {
  app: App;
  onOpen: (id: string) => void;
  onLongPress: () => void;
}) {
  const longPress = useLongPress(onLongPress, 700);
  const isReady = app.status === "ready";
  const isBuilding = app.status === "building";
  const isError = app.status === "error";

  return (
    <button
      {...longPress.handlers}
      onClick={() => isReady && onOpen(app.id)}
      disabled={!isReady}
      className={cn(
        "relative aspect-square rounded-3xl border p-3",
        "flex flex-col items-center justify-center gap-2",
        "shadow-[0_1px_0_var(--color-paper-shadow),0_18px_30px_-22px_rgba(42,36,33,0.35)]",
        "transition-transform",
        isReady &&
          "bg-paper border-line hover:scale-[1.04] active:scale-95 cursor-pointer",
        isBuilding && "bg-mochi-soft border-mochi-deep/40",
        isError && "bg-mom-soft border-mom/40 cursor-help",
        "focus:outline-none focus:ring-4 focus:ring-mochi-soft",
      )}
    >
      <span
        className={cn(
          "text-5xl sm:text-6xl",
          !isReady && "grayscale opacity-60",
        )}
        aria-hidden
      >
        {app.emoji || "✨"}
      </span>
      <span
        className="font-display text-[0.95rem] sm:text-base text-ink line-clamp-2 text-center leading-tight"
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
      >
        {app.name}
      </span>

      {isBuilding && (
        <div className="absolute top-1.5 right-2 flex items-center gap-1 text-[0.62rem] uppercase tracking-[0.16em] font-bold text-mochi-deep">
          <span className="dot size-1.5 rounded-full bg-mochi-deep" />
          <span className="dot dot-2 size-1.5 rounded-full bg-mochi-deep" />
          <span className="dot dot-3 size-1.5 rounded-full bg-mochi-deep" />
        </div>
      )}
      {isError && (
        <div className="absolute top-1.5 right-2 text-[0.62rem] uppercase tracking-[0.16em] font-bold text-mom">
          stuck
        </div>
      )}
    </button>
  );
}

/* ----------------------------- Tile menu ----------------------------- */

function KidAppMenu(props: {
  app: App;
  onClose: () => void;
  onOpen: (id: string) => void;
  onModify: (app: App) => void;
  onDelete: (id: string) => void;
}) {
  const { app, onClose, onOpen, onModify, onDelete } = props;
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const isReady = app.status === "ready";
  const isBuilding = app.status === "building";

  // Close on Escape
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        className={cn(
          "relative w-full max-w-md rounded-3xl bg-paper border border-line",
          "shadow-[0_24px_60px_-20px_rgba(42,36,33,0.5)]",
          "p-5",
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 size-10 rounded-full hover:bg-cream-deep flex items-center justify-center text-ink-soft"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-start gap-3">
          <span className="text-5xl shrink-0" aria-hidden>
            {app.emoji || "✨"}
          </span>
          <div className="flex-1 min-w-0 pr-8">
            <h3
              className="font-display text-2xl text-ink leading-tight"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
            >
              {app.name}
            </h3>
            <p className="text-[0.85rem] text-ink-faint italic mt-1 line-clamp-3 leading-snug">
              {app.description}
            </p>
            {app.lastError && (
              <p className="text-[0.78rem] text-mom italic mt-2 line-clamp-2">
                {app.lastError}
              </p>
            )}
          </div>
        </div>

        {confirmDelete ? (
          <div className="mt-5 rounded-2xl border border-mom/30 bg-mom-soft/50 p-4">
            <p className="text-[0.95rem] text-mom-ink mb-3">
              Delete this app? It can't be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onDelete(app.id)}
                className="
                  flex-1 inline-flex items-center justify-center gap-2
                  rounded-2xl px-4 py-3 font-semibold text-paper bg-mom
                  hover:scale-[1.02] active:scale-95 transition-transform
                "
              >
                <Trash2 className="size-4" /> Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="
                  flex-1 inline-flex items-center justify-center
                  rounded-2xl px-4 py-3 bg-cream-deep border border-line text-ink
                "
              >
                Keep
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={() => onOpen(app.id)}
              disabled={!isReady}
              className="
                inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3
                bg-mochi-deep text-paper font-semibold
                shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
                hover:scale-[1.02] active:scale-95 transition-transform
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
              "
            >
              Open
            </button>
            <button
              onClick={() => onModify(app)}
              disabled={isBuilding}
              className="
                inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3
                bg-cream-deep border border-line text-ink
                hover:bg-paper-shadow transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              <Pencil className="size-4" /> Modify
            </button>
            <a
              href={`/apps/${app.id}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="
                inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3
                bg-cream-deep border border-line text-ink
                hover:bg-paper-shadow transition-colors
              "
            >
              <ExternalLink className="size-4" /> Open in tab
            </a>
            <button
              onClick={() => setConfirmDelete(true)}
              className="
                inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3
                bg-mom-soft border border-mom/30 text-mom-ink
                hover:bg-mom-soft/80 transition-colors
              "
            >
              <Trash2 className="size-4" /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Mic overlay ----------------------------- */

function KidMicOverlay({
  lang,
  intent,
  onClose,
  onPrompt,
}: {
  lang: SpeechLang;
  intent: "create" | "modify";
  onClose: () => void;
  onPrompt: (text: string) => void;
}) {
  const speech = useSpeech({
    lang,
    onFinal: (text) => {
      speak(
        intent === "create"
          ? lang === "id-ID"
            ? "Sebentar ya, Mochi lagi bikin!"
            : "Hold on, Mochi is making it!"
          : lang === "id-ID"
            ? "Oke, Mochi update ya!"
            : "Okay, updating it!",
        lang,
      );
      onPrompt(text);
    },
  });

  React.useEffect(() => {
    speech.start();
    return () => {
      speech.stop();
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const promptText =
    speech.transcript ||
    (intent === "create" ? "I'm listening…" : "What should change?");

  return (
    <div className="fixed inset-0 z-50 bg-cream/95 backdrop-blur-md flex flex-col items-center justify-center p-6">
      <button
        onClick={onClose}
        aria-label="Cancel"
        className="absolute inset-0 -z-10"
      />

      <Mochi typing size={200} />
      <h2
        className="font-display text-3xl sm:text-5xl lg:text-6xl text-ink mt-8 text-center max-w-3xl leading-tight"
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
      >
        {promptText}
      </h2>

      {speech.state === "denied" && (
        <p className="text-mom italic mt-6">
          Mic blocked — ask a grown-up for help.
        </p>
      )}

      <button
        onClick={onClose}
        className="
          mt-10 inline-flex items-center justify-center
          size-16 rounded-full bg-paper border border-line text-ink-soft
          hover:bg-cream-deep transition-colors
        "
        aria-label="Cancel"
      >
        <X className="size-7" />
      </button>
    </div>
  );
}

/* -------------------------------- Build -------------------------------- */

function KidBuildView({
  app,
  onBack,
  onDone,
  onRetry,
}: {
  app: App;
  onBack: () => void;
  onDone: (id: string) => void;
  onRetry: (id: string, prompt: string) => void;
}) {
  const [lang] = useSpeechLang();
  const [phase, setPhase] = React.useState<"cooking" | "done" | "error">(
    app.status === "ready" ? "done" : app.status === "error" ? "error" : "cooking",
  );
  const [events, setEvents] = React.useState<BuildEvent[]>([]);
  const [errorMessage, setErrorMessage] = React.useState<string>(app.lastError ?? "");
  const [showLog, setShowLog] = React.useState(false);

  React.useEffect(() => {
    if (phase !== "cooking") return;
    speak(
      lang === "id-ID"
        ? "Mochi lagi bikin, sebentar ya!"
        : "Mochi is making it, hang tight!",
      lang,
    );
    const unsub = subscribeStream(app.id, (ev: BuildEvent) => {
      setEvents((prev) => [...prev, ev]);
      if (ev.type === "done") {
        setPhase("done");
        speak(lang === "id-ID" ? "Sudah jadi!" : "It's ready!", lang);
      } else if (ev.type === "error") {
        setPhase("error");
        setErrorMessage(ev.message);
        speak(
          lang === "id-ID"
            ? "Aduh, Mochi nyangkut. Coba lagi?"
            : "Oops, Mochi got stuck. Try again?",
          lang,
        );
      }
    });
    return () => {
      unsub();
      cancelSpeech();
    };
  }, [app.id, lang, phase]);

  // Auto-navigate forward when the build finishes successfully.
  React.useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => onDone(app.id), 700);
    return () => clearTimeout(t);
  }, [phase, app.id, onDone]);

  const tryAgain = () => {
    setEvents([]);
    setErrorMessage("");
    setPhase("cooking");
    onRetry(app.id, app.prompt);
  };

  const headline =
    phase === "done" ? "Ready!" : phase === "error" ? "Oops, stuck!" : "Making it…";

  return (
    <div className="h-dvh w-screen bg-cream flex flex-col items-center justify-center gap-6 px-6 relative overflow-y-auto py-8">
      <button
        onClick={onBack}
        className="
          absolute top-3 left-3 z-20
          inline-flex items-center gap-1.5 text-[0.82rem] text-ink-soft hover:text-ink
          px-3 py-2 rounded-full hover:bg-cream-deep
        "
      >
        <ArrowLeft className="size-4" /> Home
      </button>

      <Mochi typing={phase === "cooking"} happy={phase === "done"} size={200} />
      <h2
        className={cn(
          "font-display text-3xl sm:text-5xl lg:text-6xl text-center leading-tight max-w-3xl",
          phase === "error" ? "text-mom" : "text-ink",
        )}
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
      >
        {headline}
      </h2>

      {phase === "error" && (
        <div className="w-full max-w-xl rounded-3xl border border-mom/30 bg-mom-soft/40 p-5">
          {errorMessage && (
            <p className="text-[0.88rem] text-ink-soft whitespace-pre-wrap mb-4">
              {errorMessage}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={tryAgain}
              className="
                flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3
                bg-mochi-deep text-paper font-semibold
                shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
                hover:scale-[1.02] active:scale-95 transition-transform
              "
            >
              <RefreshCcw className="size-4" />
              Try again
            </button>
            <button
              onClick={onBack}
              className="
                inline-flex items-center justify-center rounded-2xl px-4 py-3
                bg-cream-deep border border-line text-ink
              "
            >
              Home
            </button>
          </div>
        </div>
      )}

      {/* Watch Mochi work */}
      <div className="w-full max-w-xl">
        <button
          onClick={() => setShowLog((v) => !v)}
          className="
            w-full inline-flex items-center justify-center gap-1.5
            text-[0.78rem] uppercase tracking-[0.16em] text-ink-soft hover:text-ink
          "
        >
          {showLog ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Watch Mochi work
        </button>
        {showLog && (
          <div className="mt-3">
            <AgentLog events={events} />
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Open -------------------------------- */

function KidOpenView({ app, onBack }: { app: App; onBack: () => void }) {
  const [iframeKey, setIframeKey] = React.useState(0);
  return (
    <div className="h-dvh w-screen flex flex-col bg-white">
      <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-line bg-cream/80 backdrop-blur-sm">
        <button
          onClick={onBack}
          aria-label="Back"
          className="
            size-14 rounded-full
            bg-mochi-deep text-paper
            flex items-center justify-center
            shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
            hover:scale-[1.04] active:scale-95 transition-transform
            focus:outline-none focus:ring-4 focus:ring-mochi-soft
          "
        >
          <ArrowLeft className="size-7" strokeWidth={2.4} />
        </button>

        <h2
          className="font-display text-xl sm:text-2xl text-ink flex items-center gap-2 truncate min-w-0"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
        >
          <span className="text-2xl shrink-0" aria-hidden>
            {app.emoji}
          </span>
          <span className="truncate">{app.name}</span>
        </h2>

        <a
          href={`/apps/${app.id}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="
            shrink-0 size-11 inline-flex items-center justify-center rounded-full
            bg-paper border border-line text-ink-soft hover:bg-cream-deep
          "
          aria-label="Open in tab"
          title="Open in tab"
        >
          <ExternalLink className="size-4" />
        </a>
      </div>

      <iframe
        key={iframeKey}
        src={`/apps/${app.id}/?t=${iframeKey}`}
        title={app.name}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        className="flex-1 w-full bg-white"
      />
    </div>
  );
}

/* ---------------------------- long-press hook ---------------------------- */

function useLongPress(callback: () => void, ms = 700) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggeredRef = React.useRef(false);

  const start = React.useCallback(() => {
    triggeredRef.current = false;
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true;
      callback();
    }, ms);
  }, [callback, ms]);

  const cancel = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => () => cancel(), [cancel]);

  return {
    handlers: {
      onMouseDown: start,
      onMouseUp: cancel,
      onMouseLeave: cancel,
      onTouchStart: start,
      onTouchEnd: cancel,
      onTouchCancel: cancel,
    },
    didTrigger: () => triggeredRef.current,
  };
}
