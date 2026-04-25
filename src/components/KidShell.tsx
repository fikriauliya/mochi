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
  MoreHorizontal,
  Keyboard,
  Sparkles,
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
        "px-3 py-1.5 2xl:px-4 2xl:py-2 rounded-full font-bold uppercase tracking-[0.18em]",
        "text-[0.7rem] 2xl:text-[0.85rem]",
        "bg-paper border border-line text-ink-soft",
        "hover:bg-cream-deep transition-colors",
        "focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft",
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
  type Composer =
    | { kind: "idle" }
    | { kind: "voice"; intent: "create" | "modify"; app?: App }
    | { kind: "text"; intent: "create" | "modify"; app?: App; seed?: string };
  const [composer, setComposer] = React.useState<Composer>({ kind: "idle" });
  const [menuApp, setMenuApp] = React.useState<App | null>(null);

  // newest first; show all statuses
  const sorted = [...apps].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="h-dvh w-screen bg-cream flex flex-col overflow-hidden">
      <div
        className="absolute right-3 z-30 flex items-center gap-2"
        style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <LangChip lang={lang} setLang={setLang} />
      </div>

      <div className="flex-1 overflow-y-auto">
       <div className="min-h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-5 sm:gap-6 px-6 py-10">
          <button
            onClick={() => setComposer({ kind: "voice", intent: "create" })}
            aria-label="Tap to talk"
            autoFocus
            className="
              relative inline-flex items-center justify-center
              size-40 sm:size-52 lg:size-60 2xl:size-72 rounded-full
              bg-mochi-deep text-paper
              shadow-[0_18px_40px_-12px_rgba(224,114,107,0.7)]
              hover:scale-[1.04] active:scale-95 transition-transform
              focus:outline-none focus-visible:ring-8 focus-visible:ring-mochi-soft
            "
          >
            <span className="absolute inset-0 rounded-full bg-mochi-deep mic-halo" />
            <Mic
              className="size-20 sm:size-24 lg:size-28 2xl:size-36 relative"
              strokeWidth={2}
            />
          </button>
          <p
            className="font-display text-2xl sm:text-3xl lg:text-4xl 2xl:text-5xl text-ink-soft italic text-center"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
          >
            Tap &amp; talk
          </p>

          {/* Suggestion chips */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 2xl:gap-2 max-w-2xl">
            <span className="text-[0.7rem] 2xl:text-[0.85rem] uppercase tracking-[0.18em] text-ink-faint mr-1">
              try
            </span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onCreate(s)}
                className="
                  px-3 py-1.5 2xl:px-4 2xl:py-2.5 rounded-full italic
                  text-[0.78rem] 2xl:text-base
                  bg-paper border border-line/70 text-ink-soft
                  hover:bg-cream-deep transition-colors
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
                "
              >
                {s}
              </button>
            ))}
          </div>

          {/* Type-instead fallback for adults / when voice isn't an option */}
          <button
            onClick={() => setComposer({ kind: "text", intent: "create" })}
            className="
              inline-flex items-center gap-1.5 px-3 py-1.5 2xl:px-4 2xl:py-2.5 rounded-full
              text-[0.78rem] 2xl:text-base text-ink-soft hover:text-ink hover:bg-cream-deep
              transition-colors
              focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
            "
          >
            <Keyboard className="size-3.5 2xl:size-4" /> or type instead
          </button>
        </div>

        <div className="px-4 pb-6 sm:pb-8">
          <h2 className="text-[0.78rem] 2xl:text-[0.92rem] uppercase tracking-[0.22em] text-ink-faint text-center mb-3 2xl:mb-5">
            Your stuff
          </h2>
          {sorted.length === 0 ? (
            <p className="text-center text-ink-faint italic 2xl:text-lg">
              No apps yet — tap the mic to make one!
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 2xl:gap-4 max-w-5xl 2xl:max-w-6xl mx-auto">
              {sorted.slice(0, 12).map((app) => (
                <KidAppTile
                  key={app.id}
                  app={app}
                  onOpen={onOpenApp}
                  onMenu={() => setMenuApp(app)}
                />
              ))}
            </div>
          )}
        </div>
       </div>
      </div>

      {composer.kind === "voice" && (
        <KidMicOverlay
          lang={lang}
          intent={composer.intent}
          onClose={() => setComposer({ kind: "idle" })}
          onSwitchToType={(seed) => {
            const c = composer;
            setComposer({
              kind: "text",
              intent: c.intent,
              ...(c.app !== undefined ? { app: c.app } : {}),
              ...(seed !== undefined ? { seed } : {}),
            });
          }}
          onPrompt={(prompt) => {
            const c = composer;
            setComposer({ kind: "idle" });
            if (c.intent === "create") onCreate(prompt);
            else if (c.app) onModify(c.app.id, prompt);
          }}
        />
      )}

      {composer.kind === "text" && (
        <KidTypeOverlay
          intent={composer.intent}
          target={composer.app}
          initial={composer.seed ?? ""}
          onClose={() => setComposer({ kind: "idle" })}
          onSubmit={(prompt) => {
            const c = composer;
            setComposer({ kind: "idle" });
            if (c.intent === "create") onCreate(prompt);
            else if (c.app) onModify(c.app.id, prompt);
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
            setComposer({ kind: "voice", intent: "modify", app });
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
  onMenu,
}: {
  app: App;
  onOpen: (id: string) => void;
  onMenu: () => void;
}) {
  const longPress = useLongPress(onMenu, 700);
  const isReady = app.status === "ready";
  const isBuilding = app.status === "building";
  const isError = app.status === "error";

  return (
    <div
      className={cn(
        "relative aspect-square rounded-3xl border",
        "shadow-[0_1px_0_var(--color-paper-shadow),0_18px_30px_-22px_rgba(42,36,33,0.35)]",
        "transition-transform",
        isReady && "bg-paper border-line hover:scale-[1.04] active:scale-[0.98]",
        isBuilding && "bg-mochi-soft border-mochi-deep/40",
        isError && "bg-mom-soft border-mom/40",
      )}
    >
      <button
        {...longPress.handlers}
        onClick={() => isReady && onOpen(app.id)}
        disabled={!isReady}
        className={cn(
          "absolute inset-0 rounded-3xl p-3",
          "flex flex-col items-center justify-center gap-2",
          isReady ? "cursor-pointer" : "cursor-help",
          "focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft",
        )}
      >
        <span
          className={cn(
            "text-5xl sm:text-6xl 2xl:text-7xl",
            !isReady && "grayscale opacity-60",
          )}
          aria-hidden
        >
          {app.emoji || "✨"}
        </span>
        <span
          className="font-display text-[0.95rem] sm:text-base 2xl:text-lg text-ink line-clamp-2 text-center leading-tight px-2"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
        >
          {app.name}
        </span>

        {isBuilding && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 text-[0.62rem] uppercase tracking-[0.16em] font-bold text-mochi-deep">
            <span className="dot size-1.5 rounded-full bg-mochi-deep" />
            <span className="dot dot-2 size-1.5 rounded-full bg-mochi-deep" />
            <span className="dot dot-3 size-1.5 rounded-full bg-mochi-deep" />
          </div>
        )}
        {isError && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[0.62rem] uppercase tracking-[0.16em] font-bold text-mom">
            stuck
          </div>
        )}
      </button>

      {/* Visible "more" button — discoverable on every device, doesn't conflict
          with the tap-to-play action because it sits in its own corner. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMenu();
        }}
        aria-label="More"
        title="More"
        className="
          absolute top-1.5 right-1.5 size-9 2xl:size-11 rounded-full
          flex items-center justify-center
          bg-paper/80 border border-line text-ink-soft
          hover:bg-cream-deep transition-colors
          opacity-90 hover:opacity-100
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
        "
      >
        <MoreHorizontal className="size-4 2xl:size-5" />
      </button>
    </div>
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
          className="absolute top-3 right-3 size-10 rounded-full hover:bg-cream-deep flex items-center justify-center text-ink-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft"
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
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-mom-soft
                "
              >
                <Trash2 className="size-4" /> Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                autoFocus
                className="
                  flex-1 inline-flex items-center justify-center
                  rounded-2xl px-4 py-3 bg-cream-deep border border-line text-ink
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
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
              autoFocus
              className="
                inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3
                bg-mochi-deep text-paper font-semibold
                shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
                hover:scale-[1.02] active:scale-95 transition-transform
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
                focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
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
                focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
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
                focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
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
                focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
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
  onSwitchToType,
}: {
  lang: SpeechLang;
  intent: "create" | "modify";
  onClose: () => void;
  onPrompt: (text: string) => void;
  onSwitchToType: (seed?: string) => void;
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
        className="font-display text-3xl sm:text-5xl lg:text-6xl 2xl:text-7xl text-ink mt-8 text-center max-w-3xl 2xl:max-w-4xl leading-tight"
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
      >
        {promptText}
      </h2>

      {speech.state === "denied" && (
        <p className="text-mom italic mt-6 text-base 2xl:text-lg">
          Mic blocked — ask a grown-up for help.
        </p>
      )}

      <div className="mt-10 flex items-center gap-3">
        <button
          onClick={() => {
            speech.stop();
            onSwitchToType(speech.transcript || undefined);
          }}
          className="
            inline-flex items-center gap-2 px-4 py-3 2xl:px-5 2xl:py-3.5 rounded-full
            bg-paper border border-line text-ink-soft hover:bg-cream-deep
            transition-colors text-[0.88rem] 2xl:text-base
            focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
          "
        >
          <Keyboard className="size-4" /> Type instead
        </button>
        <button
          onClick={onClose}
          className="
            inline-flex items-center justify-center
            size-12 2xl:size-14 rounded-full bg-paper border border-line text-ink-soft
            hover:bg-cream-deep transition-colors
            focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
          "
          aria-label="Cancel"
        >
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------- Type overlay ---------------------------- */

function KidTypeOverlay({
  intent,
  target,
  initial,
  onClose,
  onSubmit,
}: {
  intent: "create" | "modify";
  target?: App;
  initial: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    taRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  const title =
    intent === "create"
      ? "What should Mochi build?"
      : `Change ${target?.name ?? "the app"}`;

  const placeholder =
    intent === "create"
      ? "e.g. a flashcard quiz about animals"
      : `e.g. make the buttons purple, add a high-score`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        className={cn(
          "relative w-full max-w-xl 2xl:max-w-3xl rounded-3xl bg-paper border border-line",
          "shadow-[0_24px_60px_-20px_rgba(42,36,33,0.5)]",
          "p-5 sm:p-6 2xl:p-8",
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 size-10 rounded-full hover:bg-cream-deep flex items-center justify-center text-ink-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft"
        >
          <X className="size-5" />
        </button>

        <h3
          className="font-display text-2xl 2xl:text-3xl text-ink leading-tight pr-10"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
        >
          {title}
        </h3>
        {intent === "modify" && target && (
          <p className="text-[0.85rem] 2xl:text-base text-ink-faint italic mt-1">
            {target.description}
          </p>
        )}

        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={4}
          placeholder={placeholder}
          className="
            mt-4 w-full rounded-2xl border border-line bg-cream-deep/40
            px-4 py-3 text-[1rem] 2xl:text-lg text-ink
            placeholder:text-ink-faint placeholder:italic
            focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft focus:border-line-strong
            resize-y min-h-[6rem] max-h-[16rem]
          "
        />

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="
              flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 2xl:py-4
              bg-mochi-deep text-paper font-semibold 2xl:text-lg
              shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
              hover:scale-[1.02] active:scale-95 transition-transform
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
              focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
            "
          >
            <Sparkles className="size-4" />
            {intent === "create" ? "Build it" : "Change it"}
          </button>
          <button
            onClick={onClose}
            className="
              inline-flex items-center justify-center rounded-2xl px-4 py-3 2xl:py-4
              bg-cream-deep border border-line text-ink 2xl:text-lg
              focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
            "
          >
            Cancel
          </button>
        </div>
        <p className="text-[0.7rem] 2xl:text-[0.82rem] text-ink-faint italic mt-2 text-center">
          ⌘ / Ctrl + Enter to send
        </p>
      </div>
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
          absolute left-3 z-20
          inline-flex items-center gap-1.5 text-[0.82rem] 2xl:text-base text-ink-soft hover:text-ink
          px-3 py-2 rounded-full hover:bg-cream-deep
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
        "
        style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <ArrowLeft className="size-4" /> Home
      </button>

      <Mochi typing={phase === "cooking"} happy={phase === "done"} size={200} />
      <h2
        className={cn(
          "font-display text-3xl sm:text-5xl lg:text-6xl 2xl:text-7xl text-center leading-tight max-w-3xl 2xl:max-w-5xl",
          phase === "error" ? "text-mom" : "text-ink",
        )}
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
      >
        {headline}
      </h2>

      {phase === "error" && (
        <div className="w-full max-w-xl 2xl:max-w-2xl rounded-3xl border border-mom/30 bg-mom-soft/40 p-5">
          {errorMessage && (
            <p className="text-[0.88rem] 2xl:text-base text-ink-soft whitespace-pre-wrap mb-4">
              {errorMessage}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={tryAgain}
              autoFocus
              className="
                flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 2xl:py-4
                bg-mochi-deep text-paper font-semibold 2xl:text-lg
                shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
                hover:scale-[1.02] active:scale-95 transition-transform
                focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
              "
            >
              <RefreshCcw className="size-4" />
              Try again
            </button>
            <button
              onClick={onBack}
              className="
                inline-flex items-center justify-center rounded-2xl px-4 py-3 2xl:py-4
                bg-cream-deep border border-line text-ink 2xl:text-lg
                focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
              "
            >
              Home
            </button>
          </div>
        </div>
      )}

      {/* Watch Mochi work */}
      <div className="w-full max-w-xl 2xl:max-w-2xl">
        <button
          onClick={() => setShowLog((v) => !v)}
          className="
            w-full inline-flex items-center justify-center gap-1.5
            text-[0.78rem] 2xl:text-[0.92rem] uppercase tracking-[0.16em] text-ink-soft hover:text-ink
            focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft rounded-full py-1
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
      <div
        className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-line bg-cream/80 backdrop-blur-sm"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={onBack}
          aria-label="Back"
          autoFocus
          className="
            size-14 2xl:size-16 rounded-full
            bg-mochi-deep text-paper
            flex items-center justify-center
            shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
            hover:scale-[1.04] active:scale-95 transition-transform
            focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
          "
        >
          <ArrowLeft className="size-7 2xl:size-8" strokeWidth={2.4} />
        </button>

        <h2
          className="font-display text-xl sm:text-2xl 2xl:text-3xl text-ink flex items-center gap-2 truncate min-w-0"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
        >
          <span className="text-2xl 2xl:text-3xl shrink-0" aria-hidden>
            {app.emoji}
          </span>
          <span className="truncate">{app.name}</span>
        </h2>

        <a
          href={`/apps/${app.id}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="
            shrink-0 size-11 2xl:size-12 inline-flex items-center justify-center rounded-full
            bg-paper border border-line text-ink-soft hover:bg-cream-deep
            focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
          "
          aria-label="Open in tab"
          title="Open in tab"
        >
          <ExternalLink className="size-4 2xl:size-5" />
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
