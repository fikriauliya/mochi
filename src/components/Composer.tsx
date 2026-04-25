import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Camera, Pencil, ArrowUp } from "lucide-react";
import type { FamilyMember } from "@/lib/family";
import { cn } from "@/lib/utils";

type Props = {
  member: FamilyMember;
  onSend: (text: string) => void;
  disabled?: boolean;
};

export function Composer({ member, onSend, disabled }: Props) {
  const [value, setValue] = React.useState("");
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea up to a cap.
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = next + "px";
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div
      className="px-3 sm:px-6 pt-3 bg-cream/0"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
    >
      <div
        className={cn(
          "max-w-3xl mx-auto",
          "rounded-[24px] sm:rounded-[28px] bg-paper border border-line",
          "shadow-[0_1px_0_var(--color-paper-shadow),0_28px_50px_-32px_rgba(42,36,33,0.4)]",
          "px-2.5 sm:px-3 pt-2.5 sm:pt-3 pb-2",
          "focus-within:border-line-strong focus-within:ring-4 focus-within:ring-mochi-soft",
          "transition-all",
        )}
      >
        <div className="flex items-end gap-2">
          <div
            className={cn(
              "size-9 rounded-full shrink-0 ring-2 ring-offset-2 ring-offset-paper",
              "flex items-center justify-center",
              "text-[0.72rem] font-bold uppercase tracking-wider",
              {
                "bg-dad-soft text-dad ring-dad/40": member.id === "dad",
                "bg-mom-soft text-mom ring-mom/40": member.id === "mom",
                "bg-aira-soft text-aira ring-aira/40": member.id === "aira",
                "bg-kenji-soft text-kenji ring-kenji/40": member.id === "kenji",
              },
            )}
            title={`Sending as ${member.name}`}
          >
            {member.short}
          </div>

          <Textarea
            ref={taRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`Type something for Mochi, ${member.name}…`}
            className={cn(
              "min-h-[2.5rem] resize-none border-0 shadow-none",
              "bg-transparent focus-visible:ring-0 focus-visible:border-0",
              "text-[1.05rem] placeholder:text-ink-faint placeholder:italic",
              "py-2",
            )}
          />

          <button
            onClick={submit}
            disabled={disabled || !value.trim()}
            className={cn(
              "shrink-0 inline-flex items-center justify-center",
              "size-10 rounded-full",
              "bg-mochi-deep text-paper",
              "shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]",
              "hover:scale-105 active:scale-95 transition-transform",
              "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100",
            )}
            aria-label="Send"
          >
            <ArrowUp className="size-5" strokeWidth={2.4} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 pt-2 pl-1 sm:pl-12 pr-1 overflow-x-auto">
          <ComposerChip icon={Mic} label="Voice" />
          <ComposerChip icon={Camera} label="Photo" />
          <ComposerChip icon={Pencil} label="Drawing" />
          <span className="ml-auto hidden md:inline text-[0.7rem] text-ink-faint italic shrink-0">
            Press <kbd className="px-1.5 py-0.5 rounded bg-cream-deep border border-line text-ink-soft text-[0.65rem]">Enter</kbd> to send
          </span>
        </div>
      </div>
    </div>
  );
}

function ComposerChip({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      type="button"
      className="
        inline-flex items-center gap-1.5
        px-2.5 py-1 rounded-full
        text-[0.78rem] text-ink-soft
        bg-cream-deep/60 hover:bg-cream-deep
        border border-line/70
        transition-colors
      "
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
