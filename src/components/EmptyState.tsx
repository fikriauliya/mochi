import { Mochi } from "./Mochi";
import { QUICK_ACTIONS } from "@/lib/quickActions";
import type { FamilyMember } from "@/lib/family";
import { mochiGreet } from "@/lib/mockReplies";
import { cn } from "@/lib/utils";

type Props = {
  member: FamilyMember;
  onPick: (prompt: string) => void;
};

export function EmptyState({ member, onPick }: Props) {
  const greeting = mochiGreet(member);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* hero — stacks on mobile, side-by-side on sm+ */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 mb-8 sm:mb-10 rise-in">
          <Mochi size={96} happy className="sm:hidden" />
          <Mochi size={132} happy className="hidden sm:inline-flex" />
          <div className="leading-tight">
            <div className="text-[0.7rem] sm:text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint mb-2 sm:mb-3">
              Today, {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </div>
            <h2
              className="font-display text-[1.7rem] sm:text-[2.1rem] lg:text-[2.6rem] leading-[1.08] text-ink max-w-[28ch]"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
            >
              {greeting}
            </h2>
          </div>
        </div>

        {/* quick actions */}
        <div className="rise-in" style={{ animationDelay: "120ms" }}>
          <div className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint mb-3">
            A few things I can help with
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {QUICK_ACTIONS.map((action, i) => (
              <button
                key={action.id}
                onClick={() => onPick(action.example)}
                className={cn(
                  "chip group text-left",
                  "relative overflow-hidden rounded-2xl",
                  "bg-paper border border-line",
                  "px-4 py-4 flex gap-3 items-start",
                  "shadow-[0_1px_0_var(--color-paper-shadow)]",
                  "hover:shadow-[0_1px_0_var(--color-paper-shadow),0_18px_30px_-22px_rgba(42,36,33,0.35)]",
                  "hover:-translate-y-0.5 hover:border-line-strong",
                  "transition-all duration-200",
                )}
                style={{ animationDelay: `${160 + i * 50}ms` }}
              >
                <span
                  className={cn(
                    "chip-icon flex items-center justify-center size-10 rounded-xl shrink-0",
                    action.tone.bg,
                    action.tone.ink,
                  )}
                >
                  <action.icon className="size-5" strokeWidth={1.8} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[0.95rem] font-semibold text-ink leading-snug">
                    {action.title}
                  </span>
                  <span className="block text-[0.85rem] text-ink-faint italic mt-0.5 leading-snug">
                    "{action.example}"
                  </span>
                </span>
                {/* corner crease */}
                <svg
                  viewBox="0 0 24 24"
                  className="absolute top-2 right-2 size-3.5 text-line opacity-70 group-hover:text-mochi-deep group-hover:opacity-100 transition-colors"
                >
                  <path d="M6 18L18 6M14 6h4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        <p className="text-center text-ink-faint text-sm italic mt-6 sm:mt-10 rise-in" style={{ animationDelay: "420ms" }}>
          Or just type below — Mochi is listening 🌸
        </p>
      </div>
    </div>
  );
}
