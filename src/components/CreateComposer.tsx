import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  placeholder?: string;
  submitLabel?: string;
  /** When true, hides the suggestion chips (e.g. inside ModifyDrawer). */
  hideSuggestions?: boolean;
};

const SUGGESTIONS = [
  "a flashcard quiz about animals",
  "a checklist for our morning routine",
  "a tiny game where I tap colored circles",
  "a recipe randomizer for dinner",
  "a sticker board I can decorate",
];

export function CreateComposer({
  onSubmit,
  disabled,
  placeholder = "What should we build today?",
  submitLabel = "Build it",
  hideSuggestions = false,
}: Props) {
  const [value, setValue] = React.useState("");
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 220);
    el.style.height = next + "px";
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div
      className={cn(
        "rounded-[28px] bg-paper border border-line",
        "shadow-[0_1px_0_var(--color-paper-shadow),0_28px_50px_-32px_rgba(42,36,33,0.4)]",
        "p-3 sm:p-4",
        "focus-within:border-line-strong focus-within:ring-4 focus-within:ring-mochi-soft",
        "transition-all",
      )}
    >
      <div className="flex items-end gap-3">
        <Textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className={cn(
            "min-h-[2.75rem] resize-none border-0 shadow-none",
            "bg-transparent focus-visible:ring-0 focus-visible:border-0",
            "text-[1.05rem] placeholder:text-ink-faint placeholder:italic py-2",
          )}
        />

        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className={cn(
            "shrink-0 inline-flex items-center justify-center gap-2",
            "rounded-full px-4 sm:px-5 h-11",
            "bg-mochi-deep text-paper font-semibold text-[0.92rem]",
            "shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]",
            "hover:scale-[1.03] active:scale-95 transition-transform",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100",
          )}
        >
          <Sparkles className="size-4 hidden sm:inline" />
          {submitLabel}
          <ArrowUp className="size-4 sm:hidden" strokeWidth={2.4} />
        </button>
      </div>

      {!hideSuggestions && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pl-1">
          <span className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint mr-1">
            try
          </span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setValue((cur) => (cur ? cur : s))}
              className="
                px-2.5 py-1 rounded-full text-[0.75rem] italic
                bg-cream-deep/60 hover:bg-cream-deep border border-line/70
                text-ink-soft transition-colors
              "
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
