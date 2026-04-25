import type { App } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Pencil, Play } from "lucide-react";

type Props = {
  app: App;
  onOpen: (id: string) => void;
  onModify: (id: string) => void;
};

const statusLabel: Record<App["status"], string> = {
  building: "cooking",
  ready: "ready",
  error: "needs help",
};

export function AppCard({ app, onOpen, onModify }: Props) {
  return (
    <div
      className={cn(
        "relative rounded-3xl bg-paper border border-line p-5",
        "shadow-[0_1px_0_var(--color-paper-shadow),0_18px_30px_-22px_rgba(42,36,33,0.35)]",
        "transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="
            inline-flex items-center justify-center
            size-12 rounded-2xl shrink-0
            bg-cream-deep
            text-3xl
          "
          aria-hidden
        >
          {app.emoji || "✨"}
        </span>
        <div className="flex-1 min-w-0">
          <h3
            className="font-display text-[1.25rem] text-ink leading-snug truncate"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
            title={app.name}
          >
            {app.name}
          </h3>
          <p className="text-[0.85rem] text-ink-faint mt-1 line-clamp-2 leading-snug italic">
            {app.description}
          </p>
        </div>
      </div>

      {app.status !== "ready" && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] font-bold",
            app.status === "building" && "text-mochi-deep",
            app.status === "error" && "text-mom",
          )}
        >
          {app.status === "building" ? (
            <span className="flex items-center gap-1">
              <span className="dot size-1.5 rounded-full bg-mochi-deep" />
              <span className="dot dot-2 size-1.5 rounded-full bg-mochi-deep" />
              <span className="dot dot-3 size-1.5 rounded-full bg-mochi-deep" />
            </span>
          ) : null}
          {statusLabel[app.status]}
          {app.lastError && (
            <span className="text-ink-faint normal-case tracking-normal italic font-normal truncate max-w-[20rem]">
              · {app.lastError}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onOpen(app.id)}
          disabled={app.status !== "ready"}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5",
            "bg-mochi-deep text-paper text-[0.92rem] font-semibold",
            "shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]",
            "hover:scale-[1.02] active:scale-95 transition-transform",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100",
          )}
        >
          <Play className="size-4" strokeWidth={2.4} />
          Open
        </button>
        <button
          onClick={() => onModify(app.id)}
          disabled={app.status === "building"}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5",
            "bg-cream-deep border border-line text-ink text-[0.92rem]",
            "hover:bg-paper-shadow transition-colors",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
          aria-label="Modify"
        >
          <Pencil className="size-4" />
          <span className="hidden sm:inline">Modify</span>
        </button>
      </div>
    </div>
  );
}
