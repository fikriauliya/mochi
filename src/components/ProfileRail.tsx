import { FamilyAvatar } from "./FamilyAvatar";
import { FAMILY_LIST, type FamilyMember } from "@/lib/family";
import { cn } from "@/lib/utils";
import { Mochi } from "./Mochi";

type Props = {
  active: FamilyMember["id"];
  onSelect: (id: FamilyMember["id"]) => void;
  onNewChat: () => void;
};

const SAMPLE_HISTORY = [
  { id: "h1", who: "Aira", title: "How tall is the moon?", when: "Today" },
  { id: "h2", who: "Mom", title: "Tuesday meal plan", when: "Today" },
  { id: "h3", who: "Kenji", title: "Why do worms love rain", when: "Yesterday" },
  { id: "h4", who: "Dad", title: "Camping packlist", when: "Sun" },
];

export function ProfileRail({ active, onSelect, onNewChat }: Props) {
  return (
    <aside
      className="
        relative h-full w-[300px] shrink-0
        border-r border-line
        bg-paper/70 backdrop-blur-sm
        flex flex-col
      "
    >
      {/* brand */}
      <div className="px-6 pt-7 pb-5 flex items-center gap-3 rise-in" style={{ animationDelay: "40ms" }}>
        <Mochi size={44} happy />
        <div className="leading-tight">
          <div className="font-display text-[1.45rem] text-ink"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}>
            Mochi
          </div>
          <div className="text-xs text-ink-faint tracking-wide uppercase">Family kitchen</div>
        </div>
      </div>

      {/* who's chatting? */}
      <div className="px-6 pt-2 pb-3 rise-in" style={{ animationDelay: "120ms" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint">
            Who's chatting
          </div>
          <button
            onClick={onNewChat}
            className="text-[0.72rem] uppercase tracking-[0.16em] text-mochi-deep hover:underline underline-offset-4"
          >
            New chat
          </button>
        </div>

        <ul className="space-y-1.5">
          {FAMILY_LIST.map((m) => {
            const isActive = m.id === active;
            return (
              <li key={m.id}>
                <button
                  onClick={() => onSelect(m.id)}
                  className={cn(
                    "group w-full flex items-center gap-3 px-2 py-2 rounded-2xl",
                    "transition-all duration-200",
                    isActive
                      ? "bg-paper shadow-[0_1px_0_var(--color-paper-shadow),0_8px_18px_-12px_rgba(42,36,33,0.25)]"
                      : "hover:bg-paper/70",
                  )}
                >
                  <span
                    className={cn(
                      "relative inline-flex items-center justify-center rounded-full",
                      "transition-transform duration-300",
                      isActive ? "scale-100" : "scale-95 group-hover:scale-100",
                    )}
                  >
                    <FamilyAvatar id={m.id} size={42} />
                    {isActive && (
                      <span
                        className={cn(
                          "absolute -inset-1 rounded-full pointer-events-none",
                          "ring-2",
                          {
                            "ring-dad/60": m.id === "dad",
                            "ring-mom/60": m.id === "mom",
                            "ring-aira/60": m.id === "aira",
                            "ring-kenji/60": m.id === "kenji",
                          },
                        )}
                      />
                    )}
                  </span>
                  <span className="text-left flex-1">
                    <span className="block text-[0.95rem] font-semibold text-ink">{m.name}</span>
                    <span className="block text-[0.78rem] text-ink-faint">{m.role}</span>
                  </span>
                  {isActive && (
                    <span className="text-[0.66rem] uppercase tracking-[0.16em] text-mochi-deep font-bold">on</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* divider — drawn as a wavy hand-line */}
      <div className="px-6 my-2">
        <svg viewBox="0 0 240 6" className="w-full h-1.5 text-line-strong" preserveAspectRatio="none">
          <path d="M0 3 Q 20 0, 40 3 T 80 3 T 120 3 T 160 3 T 200 3 T 240 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </div>

      {/* today's chats */}
      <div className="px-6 pt-2 pb-4 flex-1 overflow-y-auto rise-in" style={{ animationDelay: "200ms" }}>
        <div className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint mb-3">
          Today's chats
        </div>
        <ul className="space-y-1.5">
          {SAMPLE_HISTORY.map((h) => (
            <li key={h.id}>
              <button
                className="
                  w-full text-left px-3 py-2 rounded-xl
                  hover:bg-paper transition-colors
                "
              >
                <div className="text-[0.9rem] text-ink truncate">{h.title}</div>
                <div className="text-[0.72rem] text-ink-faint flex items-center gap-2">
                  <span className="text-ink-soft">{h.who}</span>
                  <span className="opacity-60">·</span>
                  <span>{h.when}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* footer */}
      <div className="px-6 py-4 border-t border-line text-[0.72rem] text-ink-faint leading-relaxed rise-in"
        style={{ animationDelay: "260ms" }}>
        Mochi is a soft, friendly helper. Grown-ups stay in charge — please review what Mochi suggests, especially recipes and homework.
      </div>
    </aside>
  );
}
