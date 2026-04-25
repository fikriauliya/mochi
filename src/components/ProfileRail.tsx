import { FamilyAvatar } from "./FamilyAvatar";
import { FAMILY, FAMILY_LIST, type FamilyMember } from "@/lib/family";
import { cn } from "@/lib/utils";
import { Mochi } from "./Mochi";
import { X } from "lucide-react";
import type { App } from "@/lib/types";

type Props = {
  active: FamilyMember["id"];
  onSelect: (id: FamilyMember["id"]) => void;
  onNewChat: () => void;
  /** Drawer state (only consulted below md). */
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** All apps in the shared family library. */
  apps: App[];
  onOpenApp: (id: string) => void;
};

export function ProfileRail({
  active,
  onSelect,
  onNewChat,
  mobileOpen,
  onMobileClose,
  apps,
  onOpenApp,
}: Props) {
  // Close drawer on mobile after picking someone.
  const pick = (id: FamilyMember["id"]) => {
    onSelect(id);
    onMobileClose();
  };

  // Newest 8 apps for the rail
  const recent = [...apps].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);

  const openAndClose = (id: string) => {
    onOpenApp(id);
    onMobileClose();
  };

  return (
    <>
      {/* Backdrop — only visible on small screens when drawer is open. */}
      <div
        onClick={onMobileClose}
        className={cn(
          "md:hidden fixed inset-0 z-30 bg-ink/30 backdrop-blur-[2px]",
          "transition-opacity duration-300",
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!mobileOpen}
      />

      <aside
        className={cn(
          "z-40 h-full flex flex-col",
          "border-r border-line bg-paper/95 md:bg-paper/70 backdrop-blur-sm",
          // Off-canvas drawer below md
          "fixed top-0 left-0 w-[86vw] max-w-[320px]",
          "transition-transform duration-300 ease-out",
          "shadow-[0_24px_60px_-20px_rgba(42,36,33,0.4)] md:shadow-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Static sidebar at md+
          "md:static md:translate-x-0 md:w-[300px] md:shrink-0",
        )}
        style={{
          paddingTop: "max(env(safe-area-inset-top), 0px)",
          paddingBottom: "max(env(safe-area-inset-bottom), 0px)",
        }}
      >
      {/* brand */}
      <div className="px-6 pt-5 md:pt-7 pb-5 flex items-center gap-3 rise-in" style={{ animationDelay: "40ms" }}>
        <Mochi size={44} happy />
        <div className="leading-tight flex-1 min-w-0">
          <div className="font-display text-[1.45rem] text-ink"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}>
            Mochi
          </div>
          <div className="text-xs text-ink-faint tracking-wide uppercase">Family kitchen</div>
        </div>
        {/* Mobile-only close button */}
        <button
          onClick={onMobileClose}
          className="md:hidden inline-flex items-center justify-center size-9 rounded-full hover:bg-cream-deep text-ink-soft"
          aria-label="Close menu"
        >
          <X className="size-5" />
        </button>
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
                  onClick={() => pick(m.id)}
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

      {/* family apps */}
      <div className="px-6 pt-2 pb-4 flex-1 overflow-y-auto rise-in" style={{ animationDelay: "200ms" }}>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint">
            Family apps
          </div>
          {apps.length > 0 && (
            <span className="text-[0.7rem] text-ink-faint italic">{apps.length}</span>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="text-[0.78rem] text-ink-faint italic px-3 py-2">
            No apps yet — ask Mochi to build one.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((app) => {
              const owner = FAMILY[app.ownerId];
              return (
                <li key={app.id}>
                  <button
                    onClick={() => openAndClose(app.id)}
                    disabled={app.status !== "ready"}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-xl flex items-center gap-2.5",
                      "hover:bg-paper transition-colors",
                      "disabled:opacity-60 disabled:cursor-not-allowed",
                    )}
                  >
                    <span className="text-xl shrink-0" aria-hidden>
                      {app.emoji || "✨"}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[0.9rem] text-ink truncate">{app.name}</span>
                      <span className="block text-[0.7rem] text-ink-faint flex items-center gap-1.5">
                        <span className={cn("inline-block size-2 rounded-full", {
                          "bg-dad": owner.id === "dad",
                          "bg-mom": owner.id === "mom",
                          "bg-aira": owner.id === "aira",
                          "bg-kenji": owner.id === "kenji",
                        })} />
                        <span>{owner.name}</span>
                        {app.status === "building" && (
                          <span className="italic text-mochi-deep">· cooking</span>
                        )}
                        {app.status === "error" && (
                          <span className="italic text-mom">· stuck</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* footer */}
      <div className="px-6 py-4 border-t border-line text-[0.72rem] text-ink-faint leading-relaxed rise-in"
        style={{ animationDelay: "260ms" }}>
        Mochi builds tiny apps for the family. A grown-up should glance at every new app — Mochi is helpful but not perfect.
      </div>
      </aside>
    </>
  );
}
