import * as React from "react";
import type { BuildEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check, AlertCircle } from "lucide-react";

type Props = {
  events: BuildEvent[];
  /** When true: don't truncate text events, render `raw` events as JSON. */
  verbose?: boolean;
};

export function AgentLog({ events, verbose = false }: Props) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // In normal mode, hide raw events entirely so the kid-friendly view
  // stays uncluttered. In verbose, keep everything in arrival order.
  const visible = verbose ? events : events.filter((e) => e.type !== "raw");

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  return (
    <div
      ref={scrollRef}
      className={cn(
        "overflow-y-auto rounded-2xl border border-line bg-cream-deep/50 px-4 py-3 font-mono leading-relaxed space-y-1",
        verbose ? "max-h-[60vh] text-[0.74rem]" : "max-h-[40vh] text-[0.78rem]",
      )}
    >
      {visible.length === 0 ? (
        <div className="text-ink-faint italic">Waiting for Mochi…</div>
      ) : (
        visible.map((ev, i) => (
          <div key={i} className="flex gap-2">
            {verbose && (
              <span className="shrink-0 text-ink-faint tabular-nums w-12 text-right">
                {typeof ev.t === "number" ? `+${(ev.t / 1000).toFixed(1)}s` : ""}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <LogLine ev={ev} verbose={verbose} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function LogLine({ ev, verbose }: { ev: BuildEvent; verbose: boolean }) {
  switch (ev.type) {
    case "status":
      return <div className="text-ink-faint italic">{ev.message}</div>;
    case "text":
      return (
        <div className="text-ink whitespace-pre-wrap">
          {verbose ? ev.text : truncateLines(ev.text, 6)}
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
      return (
        <div className={cn("flex items-start gap-1.5 pl-3", ev.ok ? "text-ink-soft" : "text-mom")}>
          <span className="shrink-0">⎿</span>
          <span className={verbose ? "whitespace-pre-wrap break-all" : "truncate"}>
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
    case "raw":
      return (
        <pre className="text-[0.7rem] leading-snug text-ink-faint whitespace-pre-wrap break-all rounded bg-cream/60 px-2 py-1 my-0.5">
          {prettyJson(ev.json)}
        </pre>
      );
    case "narration":
      return (
        <div className="text-mochi-deep italic">🎙 {ev.text}</div>
      );
  }
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
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
