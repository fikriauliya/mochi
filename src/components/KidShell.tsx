import * as React from "react";
import {
  Mic,
  ArrowLeft,
  X,
  ExternalLink,
  Pencil,
  Printer,
  Camera,
  RefreshCcw,
  Star,
  Trash2,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Keyboard,
  Sparkles,
} from "lucide-react";
import { Mochi } from "./Mochi";
import { AgentLog } from "./AgentLog";
import { KidPMOverlay } from "./KidPMOverlay";
import { KidScanOverlay } from "./KidScanOverlay";
import {
  SPEECH_LANG_LABELS,
  type SpeechLang,
  useSpeechLang,
} from "@/lib/speech";
import { deleteApp, getApp, setFavorite, subscribeStream } from "@/lib/api";
import type { App, AppKind, BuildEvent } from "@/lib/types";
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

const FALLBACK_SUGGESTIONS = [
  "a flashcard quiz about animals",
  "a tap-the-color game",
  "a checklist for the morning",
  "a dinosaur sticker board",
  "a counting game with apples",
];

type ShellProps = {
  apps: App[];
  /** Live ideas from /api/suggestions; falls back to a static list. */
  suggestions: string[];
  view: View;
  currentApp: App | null;
  onCreate: (prompt: string, kind?: AppKind, lang?: SpeechLang) => void;
  onModify: (id: string, prompt: string, lang?: SpeechLang) => void;
  onOpenApp: (id: string) => void;
  onBack: () => void;
  onReload: () => void;
  onBuildDone: (id: string) => void;
};

export function KidShell(props: ShellProps) {
  const {
    apps,
    suggestions,
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
    return <KidOpenView app={currentApp} onBack={onBack} onModify={onModify} />;
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
      suggestions={
        suggestions.length > 0 ? suggestions : FALLBACK_SUGGESTIONS
      }
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
  suggestions: ReadonlyArray<string>;
  onOpenApp: (id: string) => void;
  onCreate: (prompt: string, kind?: AppKind, lang?: SpeechLang) => void;
  onModify: (id: string, prompt: string, lang?: SpeechLang) => void;
  onReload: () => void;
}) {
  const { apps, suggestions, onOpenApp, onCreate, onModify, onReload } = props;
  const [lang, setLang] = useSpeechLang();
  type Composer =
    | { kind: "idle" }
    | {
        kind: "voice";
        intent: "create" | "modify";
        app?: App;
        outputKind?: AppKind;
      }
    | {
        kind: "text";
        intent: "create" | "modify";
        app?: App;
        seed?: string;
        outputKind?: AppKind;
      }
    | { kind: "scan" };
  const [composer, setComposer] = React.useState<Composer>({ kind: "idle" });
  const [menuApp, setMenuApp] = React.useState<App | null>(null);

  // Group the home grid: a single "★ Favorites" section pinned at the
  // top (regardless of category), then one section per organize-assigned
  // category. Apps without a category fall into "Other". Section order
  // follows the smallest `position` seen within each category, so
  // sonnet's intended layout still wins.
  const grouped = React.useMemo(() => {
    if (apps.length === 0) return [] as Array<{ name: string; apps: App[] }>;
    const sorted = [...apps].sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return b.updatedAt - a.updatedAt;
    });
    const favorites = sorted.filter((a) => a.favorite);
    const rest = sorted.filter((a) => !a.favorite);
    const byCategory = new Map<string, App[]>();
    for (const a of rest) {
      const key = a.category || "Other";
      const list = byCategory.get(key);
      if (list) list.push(a);
      else byCategory.set(key, [a]);
    }
    const out: Array<{ name: string; apps: App[] }> = [];
    if (favorites.length > 0) {
      out.push({ name: "★ Favorites", apps: favorites });
    }
    for (const [name, list] of byCategory) {
      out.push({ name, apps: list });
    }
    return out;
  }, [apps]);
  const hasApps = apps.length > 0;

  const openVoice = (outputKind?: AppKind) =>
    setComposer({
      kind: "voice",
      intent: "create",
      ...(outputKind ? { outputKind } : {}),
    });
  const openType = () => setComposer({ kind: "text", intent: "create" });
  const openScan = () => setComposer({ kind: "scan" });

  return (
    <div className="h-dvh w-screen bg-cream flex flex-col overflow-hidden">
      <div
        className="absolute right-3 z-30 flex items-center gap-2"
        style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <LangChip lang={lang} setLang={setLang} />
      </div>

      {hasApps ? (
        <>
          <CompactComposerBar
            onMic={() => openVoice()}
            onPrintable={() => openVoice("printable")}
            onScan={openScan}
            onType={openType}
          />
          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6 sm:pb-8">
            {suggestions.length > 0 && (
              <div className="max-w-7xl mx-auto mb-4 flex flex-wrap items-center gap-1.5 2xl:gap-2">
                <span className="text-[0.7rem] 2xl:text-[0.85rem] uppercase tracking-[0.18em] text-ink-faint mr-1">
                  try
                </span>
                {suggestions.map((s) => (
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
            )}
            <div className="max-w-7xl mx-auto space-y-5 2xl:space-y-7">
              {grouped.map((group) => (
                <section key={group.name}>
                  <h2
                    className="font-display text-base sm:text-lg 2xl:text-xl text-ink-soft mb-2 2xl:mb-3 px-1"
                    style={{
                      fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600',
                    }}
                  >
                    {group.name}
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 2xl:gap-4">
                    {group.apps.map((app) => (
                      <KidAppTile
                        key={app.id}
                        app={app}
                        onOpen={onOpenApp}
                        onMenu={() => setMenuApp(app)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-center gap-5 sm:gap-6 px-6 py-10">
            <button
              onClick={() => openVoice()}
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

            {/* Suggestion chips for first-time users */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 2xl:gap-2 max-w-2xl">
              <span className="text-[0.7rem] 2xl:text-[0.85rem] uppercase tracking-[0.18em] text-ink-faint mr-1">
                try
              </span>
              {suggestions.map((s) => (
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

            <div className="flex flex-wrap items-center justify-center gap-2 2xl:gap-3">
              <button
                onClick={() => openVoice("printable")}
                className="
                  inline-flex items-center gap-1.5 px-4 py-2 2xl:px-5 2xl:py-3 rounded-full
                  bg-paper border-2 border-mochi-deep/40 text-mochi-deep font-bold
                  text-[0.85rem] 2xl:text-base
                  hover:bg-mochi-soft hover:border-mochi-deep transition-colors
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
                "
                title="Generate a printable infographic with gpt-image-2"
              >
                <Printer className="size-4 2xl:size-5" /> Make a printable
              </button>
              <button
                onClick={openScan}
                className="
                  inline-flex items-center gap-1.5 px-4 py-2 2xl:px-5 2xl:py-3 rounded-full
                  bg-paper border-2 border-mochi-deep/40 text-mochi-deep font-bold
                  text-[0.85rem] 2xl:text-base
                  hover:bg-mochi-soft hover:border-mochi-deep transition-colors
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
                "
                title="Photograph a printed worksheet — Mochi turns it into an app"
              >
                <Camera className="size-4 2xl:size-5" /> Scan a worksheet
              </button>
              <button
                onClick={openType}
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
          </div>
        </div>
      )}

      {composer.kind === "voice" && (
        // Both create and modify hand off to the Conversational AI
        // agent (Mochi PM). For modify, the agent gets the existing
        // app's name + description as dynamic variables so it can ask
        // a focused 1-2 question follow-up ("what should I change?").
        <KidPMOverlay
          lang={lang}
          intent={composer.intent}
          outputKind={
            composer.outputKind ?? composer.app?.kind ?? "app"
          }
          {...(composer.app !== undefined
            ? { existingApp: composer.app }
            : {})}
          onClose={() => setComposer({ kind: "idle" })}
          onSwitchToType={() => {
            const c = composer;
            setComposer({
              kind: "text",
              intent: c.intent,
              ...(c.app !== undefined ? { app: c.app } : {}),
              ...(c.outputKind !== undefined ? { outputKind: c.outputKind } : {}),
            });
          }}
          onPrompt={(prompt) => {
            const c = composer;
            setComposer({ kind: "idle" });
            if (c.intent === "create")
              onCreate(prompt, c.outputKind ?? "app", lang);
            else if (c.app) onModify(c.app.id, prompt, lang);
          }}
        />
      )}

      {composer.kind === "text" && (
        <KidTypeOverlay
          intent={composer.intent}
          target={composer.app}
          initial={composer.seed ?? ""}
          outputKind={composer.outputKind ?? "app"}
          onClose={() => setComposer({ kind: "idle" })}
          onSubmit={(prompt) => {
            const c = composer;
            setComposer({ kind: "idle" });
            if (c.intent === "create")
              onCreate(prompt, c.outputKind ?? "app", lang);
            else if (c.app) onModify(c.app.id, prompt, lang);
          }}
        />
      )}

      {composer.kind === "scan" && (
        <KidScanOverlay
          onClose={() => setComposer({ kind: "idle" })}
          onPrompt={(spec) => {
            setComposer({ kind: "idle" });
            onCreate(spec, "app", lang);
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
          onToggleFavorite={async (app) => {
            try {
              const updated = await setFavorite(app.id, !app.favorite);
              setMenuApp(updated);
              onReload();
            } catch (e) {
              console.error("favorite toggle failed", e);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Slim mic + secondary actions strip used at the top of the home screen
 * once the family has at least one app — gives the tile grid the rest of
 * the screen. Empty state still uses the centered hero mic below.
 */
function CompactComposerBar({
  onMic,
  onPrintable,
  onScan,
  onType,
}: {
  onMic: () => void;
  onPrintable: () => void;
  onScan: () => void;
  onType: () => void;
}) {
  return (
    <div
      className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-line/60 bg-cream-deep/30 backdrop-blur-sm"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <button
        onClick={onMic}
        aria-label="Tap to talk"
        autoFocus
        className="
          shrink-0 inline-flex items-center justify-center
          size-14 sm:size-16 2xl:size-20 rounded-full
          bg-mochi-deep text-paper
          shadow-[0_8px_20px_-8px_rgba(224,114,107,0.7)]
          hover:scale-[1.04] active:scale-95 transition-transform
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
        "
      >
        <Mic className="size-6 sm:size-7 2xl:size-9" strokeWidth={2.4} />
      </button>
      <p
        className="hidden sm:block font-display text-xl 2xl:text-2xl text-ink-soft italic flex-1 truncate"
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
      >
        Tap &amp; talk
      </p>
      <div className="flex-1 sm:hidden" />
      <button
        onClick={onPrintable}
        title="Generate a printable infographic"
        className="
          shrink-0 inline-flex items-center gap-1.5 px-3 py-2 sm:px-4 2xl:px-5 2xl:py-2.5 rounded-full
          bg-paper border-2 border-mochi-deep/40 text-mochi-deep font-bold
          text-[0.78rem] 2xl:text-base
          hover:bg-mochi-soft hover:border-mochi-deep transition-colors
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
        "
      >
        <Printer className="size-4 2xl:size-5" />
        <span className="hidden sm:inline">Printable</span>
      </button>
      <button
        onClick={onScan}
        title="Photograph a printed worksheet → app"
        className="
          shrink-0 inline-flex items-center gap-1.5 px-3 py-2 sm:px-4 2xl:px-5 2xl:py-2.5 rounded-full
          bg-paper border-2 border-mochi-deep/40 text-mochi-deep font-bold
          text-[0.78rem] 2xl:text-base
          hover:bg-mochi-soft hover:border-mochi-deep transition-colors
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
        "
      >
        <Camera className="size-4 2xl:size-5" />
        <span className="hidden sm:inline">Scan</span>
      </button>
      <button
        onClick={onType}
        title="Type instead"
        aria-label="Type instead"
        className="
          shrink-0 inline-flex items-center justify-center
          size-10 sm:size-11 2xl:size-12 rounded-full
          text-ink-soft hover:text-ink hover:bg-cream-deep
          transition-colors
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
        "
      >
        <Keyboard className="size-4 2xl:size-5" />
      </button>
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
        "transition-transform hover:scale-[1.04] active:scale-[0.98]",
        isReady && "bg-paper border-line",
        isBuilding && "bg-mochi-soft border-mochi-deep/40",
        isError && "bg-mom-soft border-mom/40",
      )}
    >
      <button
        {...longPress.handlers}
        // Tap is always live: ready → open, building → live log, error →
        // build view with retry. Routing is decided by the parent.
        onClick={() => onOpen(app.id)}
        className={cn(
          "absolute inset-0 rounded-3xl p-3",
          "flex flex-col items-center justify-center gap-2 cursor-pointer",
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

      {app.favorite && (
        <div
          className="absolute top-2 left-2 size-7 sm:size-8 rounded-full bg-amber-400 text-amber-900 shadow-[0_2px_6px_-2px_rgba(42,36,33,0.3)] flex items-center justify-center pointer-events-none"
          aria-label="Favorite"
        >
          <Star className="size-4 sm:size-5 fill-current" strokeWidth={2} />
        </div>
      )}

      {/* Visible "more" button — discoverable on every device, doesn't conflict
          with the tap-to-play action because it sits in its own corner. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMenu();
        }}
        aria-label="More options"
        title="More options"
        className="
          absolute top-2 right-2
          inline-flex items-center justify-center
          size-9 sm:size-10 2xl:size-11 rounded-full
          bg-paper/85 text-mochi-deep border border-mochi-deep/25
          shadow-[0_2px_6px_-2px_rgba(42,36,33,0.25)]
          hover:bg-mochi-deep hover:text-paper hover:border-transparent
          active:scale-95 transition-all
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft focus-visible:ring-offset-2 focus-visible:ring-offset-paper
        "
      >
        <MoreHorizontal className="size-4 sm:size-5" strokeWidth={2.4} />
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
  onToggleFavorite: (app: App) => void;
}) {
  const { app, onClose, onOpen, onModify, onDelete, onToggleFavorite } = props;
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
            <button
              onClick={() => onToggleFavorite(app)}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 transition-colors",
                "focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft",
                app.favorite
                  ? "bg-amber-300 text-amber-900 hover:bg-amber-400 font-semibold"
                  : "bg-cream-deep border border-line text-ink hover:bg-paper-shadow",
              )}
            >
              <Star
                className={cn("size-4", app.favorite && "fill-current")}
                strokeWidth={2}
              />
              {app.favorite ? "Favorited" : "Favorite"}
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
                col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3
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

/* ------------- composer copy: keep all the intent×kind×lang strings ------------- */

function confirmLabel(
  intent: "create" | "modify",
  outputKind: AppKind,
  short = false,
): string {
  if (intent === "modify") return short ? "Change it" : "Update it!";
  if (outputKind === "printable") return short ? "Make it" : "Make it!";
  return short ? "Build it" : "Build it!";
}

function typeOverlayTitle(
  intent: "create" | "modify",
  outputKind: AppKind,
  target?: App,
): string {
  if (intent === "modify") return `Change ${target?.name ?? "the app"}`;
  return outputKind === "printable"
    ? "What should Mochi print?"
    : "What should Mochi build?";
}

function typeOverlayPlaceholder(
  intent: "create" | "modify",
  outputKind: AppKind,
): string {
  if (intent === "modify")
    return "e.g. make the buttons purple, add a high-score";
  return outputKind === "printable"
    ? "e.g. a chore chart with stickers, a multiplication table"
    : "e.g. a flashcard quiz about animals";
}

/* ---------------------------- Type overlay ---------------------------- */

function KidTypeOverlay({
  intent,
  target,
  initial,
  outputKind = "app",
  onClose,
  onSubmit,
}: {
  intent: "create" | "modify";
  target?: App;
  initial: string;
  outputKind?: AppKind;
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

  const title = typeOverlayTitle(intent, outputKind, target);
  const placeholder = typeOverlayPlaceholder(intent, outputKind);

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
            {outputKind === "printable" ? (
              <Printer className="size-4" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {confirmLabel(intent, outputKind, true)}
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

function truncatePrompt(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trim() + "…";
}

/**
 * Ring around Mochi that fills with elapsed time. Curve `1 - e^(-t/20)`
 * means ~63% at 20s, ~86% at 40s, ~95% at 60s — fast initial hook, then
 * gradually creeping. Caller snaps to 1 on done. Pure visual; we don't
 * have ground-truth progress from claude, so this is honest about being
 * an estimate (rate of growth ≠ actual milestones).
 */
function ProgressRing({ progress, size }: { progress: number; size: number }) {
  const stroke = 6;
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <svg
      width={size}
      height={size}
      className="absolute inset-0 pointer-events-none -rotate-90"
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-line)"
        strokeWidth={stroke}
        opacity={0.4}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-mochi-deep)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 600ms ease-out" }}
      />
    </svg>
  );
}

/**
 * Foreshadow the result. While cooking, shows the user's prompt in a
 * dashed-border placeholder; on `done`, swaps to the final emoji + name
 * with a one-shot pop. Lives between the headline and the "Watch Mochi
 * work" panel — gives the kid something to anticipate during the long
 * claude-is-thinking gaps.
 */
function ResultTile({
  app,
  ready,
  fallbackLabel,
}: {
  app: App;
  ready: boolean;
  fallbackLabel: string;
}) {
  return (
    <div
      key={ready ? "ready" : "cooking"}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-3xl px-6 py-5",
        "w-44 sm:w-52 2xl:w-60 min-h-[12rem] sm:min-h-[14rem]",
        "transition-[border,background,box-shadow] duration-500",
        ready
          ? "tile-pop border-2 border-mochi-deep bg-paper shadow-[0_12px_32px_-12px_rgba(224,114,107,0.55)]"
          : "border-2 border-dashed border-line bg-cream-deep/40",
      )}
    >
      <span className="text-5xl sm:text-6xl 2xl:text-7xl">
        {ready ? app.emoji : "🍡"}
      </span>
      <span
        className={cn(
          "text-sm sm:text-base 2xl:text-lg text-center font-bold leading-snug line-clamp-2",
          ready ? "text-ink" : "text-ink-faint italic font-medium",
        )}
      >
        {ready ? app.name : fallbackLabel}
      </span>
    </div>
  );
}

function KidBuildView({
  app,
  onBack,
  onDone,
  onRetry,
}: {
  app: App;
  onBack: () => void;
  onDone: (id: string) => void;
  onRetry: (id: string, prompt: string, lang?: SpeechLang) => void;
}) {
  const [lang] = useSpeechLang();
  const [phase, setPhase] = React.useState<"cooking" | "done" | "error">(
    app.status === "ready" ? "done" : app.status === "error" ? "error" : "cooking",
  );
  const [events, setEvents] = React.useState<BuildEvent[]>([]);
  const [errorMessage, setErrorMessage] = React.useState<string>(app.lastError ?? "");
  const [showLog, setShowLog] = React.useState(false);
  // Bubbles rising out of Mochi's "pot". Spawned on a steady time
  // interval, not tied to tool events — those land too sporadically
  // to feel like progress. Each is its own DOM node with a unique key
  // + a short-lived CSS animation; the cull effect below trims oldest
  // so the list stays bounded.
  const [bubbles, setBubbles] = React.useState<
    ReadonlyArray<{ id: string; left: number }>
  >([]);
  // Refreshed manifest fields (name + emoji) after `done` lands; lets the
  // result-tile populate before the auto-redirect.
  const [resolved, setResolved] = React.useState<App | null>(null);
  // Elapsed-time-driven progress, 0..1. Pure estimate (we don't have
  // ground truth from claude); snaps to 1 the moment `done` lands.
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (phase !== "cooking") return;
    const unsub = subscribeStream(app.id, (ev: BuildEvent) => {
      setEvents((prev) => [...prev, ev]);
      if (ev.type === "done") {
        setPhase("done");
        getApp(app.id)
          .then(setResolved)
          .catch(() => {
            /* fall back to the stale prop */
          });
      } else if (ev.type === "error") {
        setPhase("error");
        setErrorMessage(ev.message);
      }
    });
    return unsub;
  }, [app.id, phase]);

  // Spawn a bubble every ~800ms while cooking. The 1.6s rise keyframe
  // means up to ~3 are airborne at once; we cap the array at 6 to bound
  // worst-case (tab backgrounded, intervals queued, etc).
  React.useEffect(() => {
    if (phase !== "cooking") return;
    const interval = setInterval(() => {
      setBubbles((bs) => [
        ...bs.slice(-5),
        { id: crypto.randomUUID(), left: 32 + Math.random() * 36 },
      ]);
    }, 800);
    return () => clearInterval(interval);
  }, [phase]);

  // Time-based progress curve: 1 - e^(-t/20). Updates every 400ms while
  // cooking; snaps to 1 on done. Decoupled from tool events so the ring
  // moves smoothly even during long claude-thinking gaps.
  React.useEffect(() => {
    if (phase === "done" || phase === "error") {
      setProgress(phase === "done" ? 1 : 0);
      return;
    }
    const t0 = Date.now();
    const tick = () => {
      const seconds = (Date.now() - t0) / 1000;
      setProgress(Math.min(0.95, 1 - Math.exp(-seconds / 20)));
    };
    tick();
    const interval = setInterval(tick, 400);
    return () => clearInterval(interval);
  }, [phase]);

  // Cull oldest bubble after its animation finishes (matches the 1.6s
  // `bubble-rise` keyframe in index.css).
  React.useEffect(() => {
    if (bubbles.length === 0) return;
    const t = setTimeout(() => {
      setBubbles((bs) => (bs.length > 0 ? bs.slice(1) : bs));
    }, 1600);
    return () => clearTimeout(t);
  }, [bubbles]);

  // Auto-navigate forward when the build finishes successfully. Bumped
  // from 700ms → 1200ms so the result-tile's reveal pop has a moment to
  // land before the iframe takes over.
  React.useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => onDone(app.id), 1200);
    return () => clearTimeout(t);
  }, [phase, app.id, onDone]);

  const tryAgain = () => {
    setEvents([]);
    setErrorMessage("");
    setPhase("cooking");
    onRetry(app.id, app.prompt, lang);
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

      <div className="relative" style={{ width: 240, height: 240 }}>
        {phase !== "error" && <ProgressRing progress={progress} size={240} />}
        <div className="absolute inset-0 flex items-center justify-center">
          <Mochi typing={phase === "cooking"} happy={phase === "done"} size={200} />
        </div>
        {phase === "cooking" && bubbles.length > 0 && (
          <div className="absolute inset-x-0 bottom-4 h-32 pointer-events-none overflow-visible">
            {bubbles.map((b) => (
              <span
                key={b.id}
                className="bubble absolute bottom-0 size-3 rounded-full bg-mochi-deep/45"
                style={{ left: `${b.left}%` }}
              />
            ))}
          </div>
        )}
      </div>
      <h2
        className={cn(
          "font-display text-3xl sm:text-5xl lg:text-6xl 2xl:text-7xl text-center leading-tight max-w-3xl 2xl:max-w-5xl",
          phase === "error" ? "text-mom" : "text-ink",
        )}
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
      >
        {headline}
      </h2>

      {phase !== "error" && (
        <ResultTile
          app={resolved ?? app}
          ready={phase === "done"}
          fallbackLabel={truncatePrompt(app.prompt, 50)}
        />
      )}

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
            inline-flex items-center justify-center gap-1.5
            text-[0.78rem] 2xl:text-[0.92rem] uppercase tracking-[0.16em] text-ink-soft hover:text-ink
            focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft rounded-full py-1 px-2
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

function KidOpenView({
  app,
  onBack,
  onModify,
}: {
  app: App;
  onBack: () => void;
  onModify: (id: string, prompt: string, lang?: SpeechLang) => void;
}) {
  const [lang] = useSpeechLang();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const isPrintable = app.kind === "printable";
  const [composer, setComposer] = React.useState<
    { kind: "idle" } | { kind: "voice" } | { kind: "text"; seed?: string }
  >({ kind: "idle" });

  const handlePrint = React.useCallback(() => {
    // Calling print() on the iframe's contentWindow drives the iframe's
    // own document — which is exactly the printable PNG with the @page
    // rules we wrote into apps/<id>/index.html.
    iframeRef.current?.contentWindow?.print();
  }, []);

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
            shrink-0
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
          className="font-display text-xl sm:text-2xl 2xl:text-3xl text-ink flex items-center gap-2 truncate min-w-0 flex-1"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
        >
          <span className="text-2xl 2xl:text-3xl shrink-0" aria-hidden>
            {app.emoji}
          </span>
          <span className="truncate">{app.name}</span>
        </h2>

        {isPrintable && (
          <button
            onClick={handlePrint}
            aria-label="Print"
            className="
              shrink-0 inline-flex items-center justify-center gap-2
              min-h-11 2xl:min-h-12 px-4 2xl:px-5 rounded-full
              bg-mochi-deep text-paper font-semibold text-sm 2xl:text-base
              shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
              hover:scale-[1.03] active:scale-95 transition-transform
              focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
            "
          >
            <Printer className="size-4 2xl:size-5" />
            <span className="hidden sm:inline">Print</span>
          </button>
        )}

        <button
          onClick={() => setComposer({ kind: "voice" })}
          aria-label="Modify this app"
          className={cn(
            "shrink-0 inline-flex items-center justify-center gap-2",
            "min-h-11 2xl:min-h-12 px-4 2xl:px-5 rounded-full",
            "font-semibold text-sm 2xl:text-base transition-transform",
            "hover:scale-[1.03] active:scale-95",
            "focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft",
            isPrintable
              ? "bg-paper border border-line text-ink hover:bg-cream-deep"
              : "bg-mochi-deep text-paper shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]",
          )}
        >
          <Pencil className="size-4 2xl:size-5" />
          <span className="hidden sm:inline">Modify</span>
        </button>

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
        ref={iframeRef}
        src={`/apps/${app.id}/`}
        title={app.name}
        sandbox={
          // Printables need `allow-modals` so window.print() opens the
          // browser's print dialog. `allow-same-origin` lets the parent
          // call into contentWindow; `allow-scripts` is included for
          // browser-compat (some engines gate print() on it even when
          // invoked from the parent).
          isPrintable
            ? "allow-scripts allow-modals allow-same-origin"
            : "allow-scripts allow-forms allow-popups allow-same-origin"
        }
        className="flex-1 w-full bg-white"
      />

      {composer.kind === "voice" && (
        <KidPMOverlay
          lang={lang}
          intent="modify"
          outputKind={app.kind}
          existingApp={app}
          onClose={() => setComposer({ kind: "idle" })}
          onSwitchToType={() =>
            setComposer({ kind: "text" })
          }
          onPrompt={(prompt) => {
            setComposer({ kind: "idle" });
            onModify(app.id, prompt, lang);
          }}
        />
      )}

      {composer.kind === "text" && (
        <KidTypeOverlay
          intent="modify"
          target={app}
          initial={composer.seed ?? ""}
          onClose={() => setComposer({ kind: "idle" })}
          onSubmit={(prompt) => {
            setComposer({ kind: "idle" });
            onModify(app.id, prompt, lang);
          }}
        />
      )}
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
