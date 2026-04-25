import { Mochi } from "./Mochi";
import { Sparkles, RefreshCcw, Menu } from "lucide-react";

type Props = {
  onClear: () => void;
  hasMessages: boolean;
  onOpenRail: () => void;
};

export function ChatHeader({ onClear, hasMessages, onOpenRail }: Props) {
  return (
    <header
      className="
        relative flex items-center justify-between gap-3
        px-4 sm:px-6 lg:px-8 py-4 lg:py-5
        border-b border-line
        bg-cream/60 backdrop-blur-sm
        rise-in
      "
      style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
    >
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        <button
          onClick={onOpenRail}
          className="
            md:hidden inline-flex items-center justify-center
            size-10 -ml-1 rounded-full
            text-ink-soft hover:bg-cream-deep
            shrink-0
          "
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>

        <div className="relative shrink-0">
          <Mochi size={40} happy />
          <span
            className="
              absolute -bottom-0 -right-0
              size-3 rounded-full bg-mochi-deep
              ring-2 ring-cream
              shadow-[0_0_0_1px_rgba(42,36,33,0.18)]
            "
            aria-label="Mochi is here"
          />
        </div>

        <div className="leading-tight min-w-0">
          <div className="hidden sm:flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">
            <Sparkles className="size-3 text-mochi-deep" /> family kitchen
          </div>
          <h1
            className="font-display text-[1.25rem] sm:text-2xl text-ink truncate"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
          >
            Mochi
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {hasMessages && (
          <button
            onClick={onClear}
            className="
              inline-flex items-center gap-2
              px-3 py-2 rounded-full
              text-[0.78rem] text-ink-soft
              border border-line
              bg-paper hover:bg-cream-deep
              transition-colors
            "
            aria-label="Start over"
          >
            <RefreshCcw className="size-3.5" />
            <span className="hidden sm:inline">Start over</span>
          </button>
        )}
      </div>
    </header>
  );
}
