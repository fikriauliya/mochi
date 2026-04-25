import { cn } from "@/lib/utils";
import { Mochi } from "./Mochi";
import { X } from "lucide-react";
import type { App } from "@/lib/types";

type Props = {
  /** Drawer state (only consulted below md). */
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** All apps in the shared family library. */
  apps: App[];
  onOpenApp: (id: string) => void;
  onNewApp: () => void;
};

export function ProfileRail({
  mobileOpen,
  onMobileClose,
  apps,
  onOpenApp,
  onNewApp,
}: Props) {
  // Newest 12 apps for the rail
  const recent = [...apps].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);

  const openAndClose = (id: string) => {
    onOpenApp(id);
    onMobileClose();
  };

  const newAndClose = () => {
    onNewApp();
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
          "fixed top-0 left-0 w-[86vw] max-w-[320px]",
          "transition-transform duration-300 ease-out",
          "shadow-[0_24px_60px_-20px_rgba(42,36,33,0.4)] md:shadow-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:translate-x-0 md:w-[260px] md:shrink-0",
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
            <div
              className="font-display text-[1.45rem] text-ink"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
            >
              Mochi
            </div>
            <div className="text-xs text-ink-faint tracking-wide uppercase">Family kitchen</div>
          </div>
          <button
            onClick={onMobileClose}
            className="md:hidden inline-flex items-center justify-center size-9 rounded-full hover:bg-cream-deep text-ink-soft"
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* New app */}
        <div className="px-4 pb-3 rise-in" style={{ animationDelay: "100ms" }}>
          <button
            onClick={newAndClose}
            className="
              w-full inline-flex items-center justify-center gap-2
              rounded-full px-4 py-2.5
              bg-mochi-deep text-paper text-[0.9rem] font-semibold
              shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
              hover:scale-[1.02] active:scale-95 transition-transform
            "
          >
            + New app
          </button>
        </div>

        {/* divider — drawn as a wavy hand-line */}
        <div className="px-6 my-2">
          <svg viewBox="0 0 240 6" className="w-full h-1.5 text-line-strong" preserveAspectRatio="none">
            <path
              d="M0 3 Q 20 0, 40 3 T 80 3 T 120 3 T 160 3 T 200 3 T 240 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </div>

        {/* family apps */}
        <div
          className="px-4 pt-2 pb-4 flex-1 overflow-y-auto rise-in"
          style={{ animationDelay: "200ms" }}
        >
          <div className="flex items-baseline justify-between mb-3 px-2">
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
            <ul className="space-y-1">
              {recent.map((app) => (
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
                      <span className="block text-[0.9rem] text-ink truncate">
                        {app.name}
                      </span>
                      {app.status !== "ready" && (
                        <span
                          className={cn(
                            "block text-[0.7rem] italic",
                            app.status === "building" && "text-mochi-deep",
                            app.status === "error" && "text-mom",
                          )}
                        >
                          {app.status === "building" ? "cooking…" : "stuck"}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* footer */}
        <div
          className="px-6 py-4 border-t border-line text-[0.72rem] text-ink-faint leading-relaxed rise-in"
          style={{ animationDelay: "260ms" }}
        >
          Mochi builds tiny apps for the family. A grown-up should glance at every new app — Mochi is helpful but not perfect.
        </div>
      </aside>
    </>
  );
}
