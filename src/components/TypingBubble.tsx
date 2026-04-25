import { Mochi } from "./Mochi";

export function TypingBubble() {
  return (
    <div className="bubble-in flex items-end gap-3 max-w-[42rem]">
      <Mochi size={48} typing />
      <div className="relative">
        <svg viewBox="0 0 12 12" className="absolute -left-1.5 bottom-2 w-3 h-3 text-paper">
          <path d="M12 0 L0 6 L12 12 Z" fill="currentColor" />
        </svg>
        <div className="flex items-center gap-1.5 bg-paper rounded-3xl rounded-bl-md px-5 py-4 border border-line shadow-[0_1px_0_var(--color-paper-shadow)]">
          <span className="dot size-2 rounded-full bg-mochi-deep" />
          <span className="dot dot-2 size-2 rounded-full bg-mochi-deep" />
          <span className="dot dot-3 size-2 rounded-full bg-mochi-deep" />
          <span className="ml-2 text-[0.78rem] italic text-ink-faint">Mochi's thinking…</span>
        </div>
      </div>
    </div>
  );
}
