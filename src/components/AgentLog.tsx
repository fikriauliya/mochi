import * as React from "react";
import type { BuildEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check, AlertCircle } from "lucide-react";

type Props = {
  events: BuildEvent[];
};

export function AgentLog({ events }: Props) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto rounded-2xl border border-line bg-cream-deep/50 px-4 py-3 font-mono leading-relaxed space-y-1 max-h-[40vh] text-[0.78rem]"
    >
      {events.length === 0 ? (
        <div className="text-ink-faint italic">Waiting for Mochi…</div>
      ) : (
        events.map((ev, i) => <LogLine key={i} ev={ev} />)
      )}
    </div>
  );
}

function LogLine({ ev }: { ev: BuildEvent }) {
  switch (ev.type) {
    case "status":
      return <div className="text-ink-faint italic">{ev.message}</div>;
    case "text":
      return (
        <div className="text-ink whitespace-pre-wrap">
          {truncateLines(ev.text, 6)}
        </div>
      );
    case "tool":
      return (
        <div className="text-ink">
          <span className={cn(toolClass(ev.tool))}>● {ev.tool}</span>
          {ev.summary && (
            <span className="text-ink-soft"> ({ev.summary})</span>
          )}
        </div>
      );
    case "tool_result":
      // Successes get a one-line summary so the panel stays scannable.
      // Failures get the full content so the user can actually read what
      // broke without flipping anything on.
      return (
        <div className={cn("flex items-start gap-1.5 pl-3", ev.ok ? "text-ink-soft" : "text-mom")}>
          <span className="shrink-0">⎿</span>
          <span className={ev.ok ? "truncate" : "whitespace-pre-wrap break-words"}>
            {ev.summary || (ev.ok ? "ok" : "failed")}
          </span>
        </div>
      );
    case "done":
      return (
        <div className="text-dad font-bold flex items-center gap-1.5">
          <Check className="size-3.5" /> done
        </div>
      );
    case "error":
      return (
        <div className="text-mom font-bold flex items-start gap-1.5">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{ev.message}</span>
        </div>
      );
  }
}

function toolClass(tool: string): string {
  switch (tool) {
    case "Write":
    case "Edit":
      return "text-aira font-semibold";
    case "Bash":
      return "text-kenji font-semibold";
    default:
      return "text-ink-soft font-semibold";
  }
}

function truncateLines(s: string, n: number): string {
  const lines = s.split("\n");
  if (lines.length <= n) return s;
  return lines.slice(0, n).join("\n") + `\n…(+${lines.length - n} more)`;
}
