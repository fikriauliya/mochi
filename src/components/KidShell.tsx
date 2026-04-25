import * as React from "react";
import { Mic, ArrowLeft, X } from "lucide-react";
import { Mochi } from "./Mochi";
import { useSpeech, useSpeechLang } from "@/lib/speech";
import { speak, cancelSpeech } from "@/lib/tts";
import { subscribeStream } from "@/lib/api";
import type { App, BuildEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Kid mode is a parallel UI for non-readers (currently aimed at a 3-year-old).
 * Same view-state machine as grown-up mode, totally different visuals:
 *   - Home: a giant pulsing mic + a tile grid of "Mainan kamu"
 *   - Build: friendly mascot + spoken "lagi dibikin…" / "sudah jadi!"
 *   - Open: full iframe + a chunky back button
 *
 * Exit is hidden: long-press the small Mochi face in the corner for 3 seconds.
 */

type View =
  | { kind: "home" }
  | { kind: "build"; appId: string }
  | { kind: "open"; appId: string };

type Props = {
  apps: App[];
  view: View;
  currentApp: App | null;
  onCreate: (prompt: string) => void;
  onOpenApp: (id: string) => void;
  onBack: () => void;
  onExitKidMode: () => void;
};

export function KidShell(props: Props) {
  const { apps, view, currentApp, onCreate, onOpenApp, onBack, onExitKidMode } =
    props;

  if (view.kind === "open" && currentApp) {
    return <KidOpenView app={currentApp} onBack={onBack} onExit={onExitKidMode} />;
  }
  if (view.kind === "build" && currentApp) {
    return <KidBuildView app={currentApp} onExit={onExitKidMode} />;
  }
  return (
    <KidHome
      apps={apps}
      onOpenApp={onOpenApp}
      onCreate={onCreate}
      onExit={onExitKidMode}
    />
  );
}

/* -------------------------------- Home -------------------------------- */

function KidHome(props: {
  apps: App[];
  onOpenApp: (id: string) => void;
  onCreate: (prompt: string) => void;
  onExit: () => void;
}) {
  const { apps, onOpenApp, onCreate, onExit } = props;
  const [lang] = useSpeechLang();
  const [listening, setListening] = React.useState(false);
  const ready = apps.filter((a) => a.status === "ready");

  return (
    <div className="h-dvh w-screen bg-cream flex flex-col overflow-hidden">
      <KidExitCorner onExit={onExit} />

      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <button
          onClick={() => setListening(true)}
          aria-label="Pencet untuk ngomong"
          className="
            relative inline-flex items-center justify-center
            size-48 sm:size-56 lg:size-64 rounded-full
            bg-mochi-deep text-paper
            shadow-[0_18px_40px_-12px_rgba(224,114,107,0.7)]
            hover:scale-[1.04] active:scale-95 transition-transform
            focus:outline-none focus:ring-8 focus:ring-mochi-soft
          "
        >
          <span className="absolute inset-0 rounded-full bg-mochi-deep mic-halo" />
          <Mic className="size-24 sm:size-28 lg:size-32 relative" strokeWidth={2} />
        </button>
        <p
          className="font-display text-2xl sm:text-3xl lg:text-4xl text-ink-soft italic text-center"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
        >
          Tap &amp; talk
        </p>
      </div>

      {ready.length > 0 && (
        <div className="px-4 pb-6 sm:pb-8">
          <h2 className="text-[0.78rem] uppercase tracking-[0.22em] text-ink-faint text-center mb-3">
            Your stuff
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 max-w-5xl mx-auto">
            {ready.slice(0, 10).map((app) => (
              <KidAppTile key={app.id} app={app} onOpen={onOpenApp} />
            ))}
          </div>
        </div>
      )}

      {listening && (
        <KidMicOverlay
          lang={lang}
          onClose={() => setListening(false)}
          onPrompt={(prompt) => {
            setListening(false);
            onCreate(prompt);
          }}
        />
      )}
    </div>
  );
}

function KidAppTile({
  app,
  onOpen,
}: {
  app: App;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onOpen(app.id)}
      className={cn(
        "aspect-square rounded-3xl bg-paper border border-line",
        "p-3 flex flex-col items-center justify-center gap-2",
        "shadow-[0_1px_0_var(--color-paper-shadow),0_18px_30px_-22px_rgba(42,36,33,0.35)]",
        "hover:scale-[1.04] active:scale-95 transition-transform",
        "focus:outline-none focus:ring-4 focus:ring-mochi-soft",
      )}
    >
      <span className="text-5xl sm:text-6xl" aria-hidden>
        {app.emoji || "✨"}
      </span>
      <span
        className="font-display text-[0.95rem] sm:text-base text-ink line-clamp-2 text-center leading-tight"
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
      >
        {app.name}
      </span>
    </button>
  );
}

/* ----------------------------- Mic overlay ----------------------------- */

function KidMicOverlay({
  lang,
  onClose,
  onPrompt,
}: {
  lang: "id-ID" | "en-US";
  onClose: () => void;
  onPrompt: (text: string) => void;
}) {
  const speech = useSpeech({
    lang,
    onFinal: (text) => {
      speak(
        lang === "id-ID"
          ? "Sebentar ya, Mochi lagi bikin!"
          : "Hold on, Mochi is making it!",
        lang,
      );
      onPrompt(text);
    },
  });

  // Auto-start when overlay opens.
  React.useEffect(() => {
    speech.start();
    return () => {
      speech.stop();
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const promptText = speech.transcript || "I'm listening…";

  return (
    <div className="fixed inset-0 z-50 bg-cream/95 backdrop-blur-md flex flex-col items-center justify-center p-6">
      {/* Tap-anywhere-to-cancel backdrop */}
      <button
        onClick={onClose}
        aria-label="Batal"
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
        aria-label="Batal"
      >
        <X className="size-7" />
      </button>
    </div>
  );
}

/* -------------------------------- Build -------------------------------- */

function KidBuildView({
  app,
  onExit,
}: {
  app: App;
  onExit: () => void;
}) {
  const [lang] = useSpeechLang();
  const [phase, setPhase] = React.useState<"cooking" | "done" | "error">(
    app.status === "ready" ? "done" : app.status === "error" ? "error" : "cooking",
  );

  React.useEffect(() => {
    if (phase !== "cooking") return;
    speak(
      lang === "id-ID"
        ? "Mochi lagi bikin, sebentar ya!"
        : "Mochi is making it, hang tight!",
      lang,
    );
    const unsub = subscribeStream(app.id, (ev: BuildEvent) => {
      if (ev.type === "done") {
        setPhase("done");
        speak(lang === "id-ID" ? "Sudah jadi!" : "It's ready!", lang);
      } else if (ev.type === "error") {
        setPhase("error");
        speak(
          lang === "id-ID"
            ? "Aduh, Mochi nyangkut. Coba lagi nanti ya."
            : "Oops, Mochi got stuck. Try again later.",
          lang,
        );
      }
    });
    return () => {
      unsub();
      cancelSpeech();
    };
  }, [app.id, lang, phase]);

  const headline =
    phase === "done"
      ? "Ready!"
      : phase === "error"
        ? "Oops, stuck!"
        : "Making it…";

  return (
    <div className="h-dvh w-screen bg-cream flex flex-col items-center justify-center gap-8 px-6 relative">
      <KidExitCorner onExit={onExit} />
      <Mochi typing={phase === "cooking"} happy={phase === "done"} size={220} />
      <h2
        className={cn(
          "font-display text-3xl sm:text-5xl lg:text-6xl text-center leading-tight max-w-3xl",
          phase === "error" ? "text-mom" : "text-ink",
        )}
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
      >
        {headline}
      </h2>
    </div>
  );
}

/* -------------------------------- Open -------------------------------- */

function KidOpenView({
  app,
  onBack,
  onExit,
}: {
  app: App;
  onBack: () => void;
  onExit: () => void;
}) {
  return (
    <div className="h-dvh w-screen flex flex-col bg-white">
      <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-line bg-cream/80 backdrop-blur-sm">
        <button
          onClick={onBack}
          aria-label="Kembali"
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

        <KidExitCorner onExit={onExit} inline />
      </div>

      <iframe
        src={`/apps/${app.id}/`}
        title={app.name}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        className="flex-1 w-full bg-white"
      />
    </div>
  );
}

/* ----------------------------- Exit corner ---------------------------- */
/**
 * Long-press on the tiny Mochi face for 3 seconds to leave kid mode.
 * Discoverable for adults, infeasible for a 3-year-old to do accidentally.
 */
function KidExitCorner({
  onExit,
  inline = false,
}: {
  onExit: () => void;
  inline?: boolean;
}) {
  const [progress, setProgress] = React.useState(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = React.useRef<number>(0);

  const cancel = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(0);
  }, []);

  const start = React.useCallback(() => {
    startRef.current = Date.now();
    setProgress(0);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const ratio = Math.min(1, elapsed / 3000);
      setProgress(ratio);
      if (ratio >= 1) {
        cancel();
        onExit();
      }
    }, 60);
  }, [cancel, onExit]);

  React.useEffect(() => () => cancel(), [cancel]);

  const handlers = {
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  };

  return (
    <div
      className={cn(
        inline ? "shrink-0" : "absolute top-3 right-3 z-30",
      )}
    >
      <button
        {...handlers}
        aria-label="Keluar dari mode anak (tahan 3 detik)"
        className={cn(
          "relative size-12 rounded-full flex items-center justify-center",
          "bg-paper/70 hover:bg-paper transition-colors",
        )}
      >
        <Mochi size={32} happy />
        {progress > 0 && (
          <span
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: `conic-gradient(var(--color-mochi-deep) ${progress * 360}deg, transparent 0)`,
              opacity: 0.35,
              maskImage:
                "radial-gradient(circle, transparent 60%, black 62%)",
              WebkitMaskImage:
                "radial-gradient(circle, transparent 60%, black 62%)",
            }}
          />
        )}
      </button>
    </div>
  );
}
