import { Mochi } from "./Mochi";
import { FamilyAvatar } from "./FamilyAvatar";
import type { FamilyMember } from "@/lib/family";
import { cn } from "@/lib/utils";

export type Message = {
  id: string;
  /** "mochi" or a member id. */
  authorId: "mochi" | FamilyMember["id"];
  text: string;
  ts: number;
};

type Props = {
  message: Message;
  /** When the author is a family member. */
  member?: FamilyMember;
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MessageBubble({ message, member }: Props) {
  const isMochi = message.authorId === "mochi";

  if (isMochi) {
    return (
      <div className="bubble-in flex items-end gap-3 max-w-[42rem]">
        <Mochi size={48} happy />
        <div className="relative flex-1">
          {/* tail */}
          <svg viewBox="0 0 12 12" className="absolute -left-1.5 bottom-2 w-3 h-3 text-paper">
            <path d="M12 0 L0 6 L12 12 Z" fill="currentColor" />
          </svg>
          <div
            className="
              relative bg-paper rounded-3xl rounded-bl-md
              px-5 py-4
              border border-line
              shadow-[0_1px_0_var(--color-paper-shadow),0_14px_28px_-22px_rgba(42,36,33,0.45)]
              text-ink
            "
          >
            <div className="text-[0.72rem] uppercase tracking-[0.18em] text-mochi-deep font-bold mb-1.5">
              Mochi
            </div>
            <p className="leading-relaxed whitespace-pre-wrap text-[1.02rem]">{message.text}</p>
            <div className="text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint mt-2">
              {formatTime(message.ts)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!member) return null;
  const m = member;

  return (
    <div className="bubble-in flex items-end gap-3 justify-end max-w-[42rem] ml-auto">
      <div className="relative">
        <div
          className={cn(
            "relative rounded-3xl rounded-br-md px-5 py-4",
            "border",
            "shadow-[0_1px_0_var(--color-paper-shadow),0_14px_28px_-22px_rgba(42,36,33,0.35)]",
            {
              "bg-dad-soft border-dad/30 text-dad-ink": m.id === "dad",
              "bg-mom-soft border-mom/30 text-mom-ink": m.id === "mom",
              "bg-aira-soft border-aira/30 text-aira-ink": m.id === "aira",
              "bg-kenji-soft border-kenji/30 text-kenji-ink": m.id === "kenji",
            },
          )}
        >
          <div className={cn("text-[0.72rem] uppercase tracking-[0.18em] font-bold mb-1.5", m.classes.text)}>
            {m.name}
          </div>
          <p className="leading-relaxed whitespace-pre-wrap text-[1.02rem]">{message.text}</p>
          <div className="text-[0.66rem] uppercase tracking-[0.16em] mt-2 opacity-60">
            {formatTime(message.ts)}
          </div>
        </div>
        {/* tail */}
        <svg viewBox="0 0 12 12"
          className={cn(
            "absolute -right-1.5 bottom-2 w-3 h-3",
            {
              "text-dad-soft": m.id === "dad",
              "text-mom-soft": m.id === "mom",
              "text-aira-soft": m.id === "aira",
              "text-kenji-soft": m.id === "kenji",
            },
          )}
        >
          <path d="M0 0 L12 6 L0 12 Z" fill="currentColor" />
        </svg>
      </div>
      <FamilyAvatar id={m.id} size={48} />
    </div>
  );
}
