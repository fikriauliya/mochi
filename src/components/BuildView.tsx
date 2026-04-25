import * as React from "react";
import { Mochi } from "./Mochi";
import { AgentLog } from "./AgentLog";
import { subscribeStream } from "@/lib/api";
import type { App, BuildEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, AlertCircle, RefreshCcw, ArrowLeft } from "lucide-react";

type Props = {
  app: App;
  onDone: (id: string) => void;
  onBack: () => void;
  onRetry: () => void;
};

const COOKING_LINES = [
  "Mochi is preparing the kitchen…",
  "Mixing the dough…",
  "Tasting as we go…",
  "Adding a sprinkle of magic…",
  "Folding in details…",
  "Almost ready…",
];

export function BuildView({ app, onDone, onBack, onRetry }: Props) {
  const [events, setEvents] = React.useState<BuildEvent[]>([]);
  const [showLog, setShowLog] = React.useState(false);
  const [terminal, setTerminal] = React.useState<"done" | "error" | null>(
    app.status === "ready" ? "done" : app.status === "error" ? "error" : null,
  );
  const [errorMessage, setErrorMessage] = React.useState<string>(app.lastError ?? "");
  const [tick, setTick] = React.useState(0);

  // Rotate the friendly status line every 3.5s while building
  React.useEffect(() => {
    if (terminal) return;
    const t = setInterval(() => setTick((x) => x + 1), 3500);
    return () => clearInterval(t);
  }, [terminal]);

  // Open the SSE stream
  React.useEffect(() => {
    if (terminal) return; // already finished

    const unsub = subscribeStream(
      app.id,
      (ev) => {
        setEvents((prev) => [...prev, ev]);
        if (ev.type === "done") {
          setTerminal("done");
        } else if (ev.type === "error") {
          setTerminal("error");
          setErrorMessage(ev.message);
        }
      },
      () => {
        // Connection closed without a terminal event — assume the build
        // finished (or was already finished) and let onDone double-check.
      },
    );
    return unsub;
  }, [app.id, terminal]);

  // Auto-redirect on done (after a short beat so the user sees "done")
  React.useEffect(() => {
    if (terminal !== "done") return;
    const t = setTimeout(() => onDone(app.id), 700);
    return () => clearTimeout(t);
  }, [terminal, app.id, onDone]);

  const statusLine =
    terminal === "done"
      ? "Done!"
      : terminal === "error"
        ? "Mochi got stuck."
        : COOKING_LINES[tick % COOKING_LINES.length];

  // Latest tool/text event as a sub-line
  const latestActivity = lastInteresting(events);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-14">
        <button
          onClick={onBack}
          className="
            inline-flex items-center gap-1.5
            text-[0.78rem] text-ink-soft hover:text-ink
            mb-6
          "
        >
          <ArrowLeft className="size-3.5" /> Back to family kitchen
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-4">
            <Mochi
              size={148}
              typing={!terminal}
              happy={terminal === "done"}
            />
          </div>
          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint mb-2">
            Building <span className="text-ink">{app.name || app.prompt.slice(0, 40)}</span>
          </div>
          <h2
            className={cn(
              "font-display text-[1.7rem] sm:text-[2rem] leading-tight",
              terminal === "error" ? "text-mom" : "text-ink",
            )}
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
          >
            {statusLine}
          </h2>
          {latestActivity && !terminal && (
            <p className="text-[0.92rem] italic text-ink-faint mt-2">
              {latestActivity}
            </p>
          )}
        </div>

        {/* Watch Mochi work */}
        <div className="mt-8">
          <button
            onClick={() => setShowLog((v) => !v)}
            className="
              w-full inline-flex items-center justify-center gap-1.5
              text-[0.78rem] uppercase tracking-[0.16em] text-ink-soft hover:text-ink
            "
          >
            {showLog ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Watch Mochi work
          </button>
          {showLog && (
            <div className="mt-3">
              <AgentLog events={events} />
            </div>
          )}
        </div>

        {terminal === "error" && (
          <div className="mt-8 rounded-3xl border border-mom/30 bg-mom-soft/40 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="text-mom size-5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-display text-[1.1rem] text-mom-ink mb-1"
                  style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}>
                  Mochi got stuck.
                </div>
                <p className="text-[0.88rem] text-ink-soft whitespace-pre-wrap">
                  {errorMessage || "Something went wrong while building."}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={onRetry}
                className="
                  inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5
                  bg-mochi-deep text-paper font-semibold text-[0.92rem]
                  shadow-[0_6px_16px_-6px_rgba(224,114,107,0.7)]
                  hover:scale-[1.02] active:scale-95 transition-transform
                "
              >
                <RefreshCcw className="size-4" />
                Try again
              </button>
              <button
                onClick={onBack}
                className="
                  inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5
                  bg-cream-deep border border-line text-ink text-[0.92rem]
                "
              >
                Back home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function lastInteresting(events: BuildEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.type === "status") return e.message;
    if (e.type === "tool") {
      const verb =
        e.tool === "Write"
          ? "writing"
          : e.tool === "Edit"
            ? "editing"
            : e.tool.toLowerCase();
      return e.summary ? `${verb} ${e.summary}` : `running ${verb}`;
    }
    if (e.type === "text" && e.text.length < 80) return e.text;
  }
  return null;
}
