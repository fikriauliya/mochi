import * as React from "react";
import type { App } from "@/lib/types";
import type { FamilyMember } from "@/lib/family";
import { ArrowLeft, Pencil, ExternalLink } from "lucide-react";
import { ModifyDrawer } from "./ModifyDrawer";
import { cn } from "@/lib/utils";

type Props = {
  app: App;
  member: FamilyMember;
  onBack: () => void;
};

export function OpenView({ app, member, onBack }: Props) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [iframeKey, setIframeKey] = React.useState(0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* slim chrome bar */}
      <div
        className={cn(
          "flex items-center gap-2 sm:gap-3",
          "px-3 sm:px-5 py-2.5",
          "border-b border-line bg-cream/70 backdrop-blur-sm",
          "shrink-0",
        )}
      >
        <button
          onClick={onBack}
          className="
            inline-flex items-center gap-1.5 size-9 sm:h-9 sm:w-auto sm:px-3 rounded-full
            text-[0.82rem] text-ink-soft hover:text-ink hover:bg-cream-deep justify-center
          "
          aria-label="Back to family kitchen"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Back</span>
        </button>

        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-2xl shrink-0" aria-hidden>
            {app.emoji || "✨"}
          </span>
          <div className="min-w-0">
            <h2
              className="font-display text-[1.05rem] sm:text-[1.2rem] text-ink leading-tight truncate"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
            >
              {app.name}
            </h2>
            <div className="text-[0.7rem] text-ink-faint italic truncate hidden sm:block">
              {app.description}
            </div>
          </div>
        </div>

        <a
          href={`/apps/${app.id}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="
            hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-full
            text-[0.78rem] text-ink-soft hover:text-ink
            border border-line bg-paper hover:bg-cream-deep
          "
          title="Open in new tab"
        >
          <ExternalLink className="size-3.5" />
          New tab
        </a>

        <button
          onClick={() => setDrawerOpen(true)}
          className="
            inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full
            bg-mochi-deep text-paper text-[0.85rem] font-semibold
            shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
            hover:scale-[1.03] active:scale-95 transition-transform
          "
        >
          <Pencil className="size-3.5" />
          Modify
        </button>
      </div>

      {/* the app, sandboxed */}
      <iframe
        key={iframeKey}
        src={`/apps/${app.id}/?t=${iframeKey}`}
        title={app.name}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        className="flex-1 w-full bg-white"
      />

      <ModifyDrawer
        app={app}
        member={member}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onModified={() => setIframeKey((k) => k + 1)}
      />
    </div>
  );
}
