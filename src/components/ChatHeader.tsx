import { FamilyAvatar } from "./FamilyAvatar";
import { Mochi } from "./Mochi";
import type { FamilyMember } from "@/lib/family";
import { Sparkles, RefreshCcw } from "lucide-react";

type Props = {
  member: FamilyMember;
  onClear: () => void;
  hasMessages: boolean;
};

export function ChatHeader({ member, onClear, hasMessages }: Props) {
  return (
    <header className="
      relative flex items-center justify-between
      px-8 py-5
      border-b border-line
      bg-cream/60 backdrop-blur-sm
      rise-in
    ">
      <div className="flex items-center gap-4">
        <div className="relative">
          <Mochi size={44} happy />
          <span
            className="
              absolute -bottom-0 -right-0
              size-3.5 rounded-full bg-mom
              ring-2 ring-cream
              shadow-[0_0_0_1px_rgba(42,36,33,0.18)]
            "
            aria-label="Mochi is here"
          />
        </div>
        <div className="leading-tight">
          <div className="flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint">
            <Sparkles className="size-3 text-mochi-deep" /> in the kitchen with
          </div>
          <h1
            className="font-display text-2xl text-ink"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
          >
            {member.name}{" "}
            <span className="text-ink-faint italic font-normal text-xl">·</span>{" "}
            <span className="italic text-ink-soft text-xl">{member.role}</span>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <FamilyAvatar id={member.id} size={42} />
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
          >
            <RefreshCcw className="size-3.5" />
            Start over
          </button>
        )}
      </div>
    </header>
  );
}
