import * as React from "react";
import { CreateComposer } from "./CreateComposer";
import { AgentLog } from "./AgentLog";
import { modifyApp, subscribeStream } from "@/lib/api";
import type { App, BuildEvent } from "@/lib/types";
import type { FamilyMember } from "@/lib/family";
import { cn } from "@/lib/utils";
import { X, Sparkles } from "lucide-react";

type Props = {
  app: App;
  member: FamilyMember;
  open: boolean;
  onClose: () => void;
  /** Called when a modify completes successfully so the iframe can refresh. */
  onModified: () => void;
};

type Phase = "idle" | "running" | "done" | "error";

export function ModifyDrawer({ app, member, open, onClose, onModified }: Props) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [events, setEvents] = React.useState<BuildEvent[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");

  // Reset events when drawer is reopened on a clean state
  React.useEffect(() => {
    if (!open) return;
    if (phase === "idle") {
      setEvents([]);
      setErrorMessage("");
    }
  }, [open, phase]);

  // Close drawer on Escape
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = async (prompt: string) => {
    setEvents([]);
    setErrorMessage("");
    setPhase("running");

    try {
      await modifyApp(app.id, { prompt, ownerId: member.id });
    } catch (e) {
      setPhase("error");
      setErrorMessage(e instanceof Error ? e.message : String(e));
      return;
    }

    const unsub = subscribeStream(app.id, (ev) => {
      setEvents((prev) => [...prev, ev]);
      if (ev.type === "done") {
        setPhase("done");
        unsub();
        onModified();
        // Allow another round of modifications
        setTimeout(() => setPhase("idle"), 1200);
      } else if (ev.type === "error") {
        setPhase("error");
        setErrorMessage(ev.message);
        unsub();
      }
    });
  };

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]",
          "transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!open}
      />

      {/* drawer: bottom sheet on mobile, right sheet on desktop */}
      <div
        className={cn(
          "fixed z-50 bg-paper border-line shadow-[0_-12px_60px_-20px_rgba(42,36,33,0.4)]",
          "flex flex-col",
          // mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-[28px] border-t",
          // desktop: right sheet
          "md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:top-auto",
          "md:w-[26rem] md:max-h-none md:rounded-none md:rounded-l-[28px] md:border-l md:border-t-0",
          "transition-transform duration-300 ease-out",
          open
            ? "translate-y-0 md:translate-x-0"
            : "translate-y-full md:translate-y-0 md:translate-x-full",
        )}
        style={{
          paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
        }}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-mochi-deep" />
            <h3
              className="font-display text-[1.2rem] text-ink"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 600' }}
            >
              Modify {app.emoji} {app.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="size-9 inline-flex items-center justify-center rounded-full hover:bg-cream-deep text-ink-soft"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* status line */}
        <div className="px-5 pb-2">
          <p className="text-[0.85rem] italic text-ink-faint">
            {phase === "running"
              ? "Mochi is updating the app — hang on."
              : phase === "done"
                ? "Mochi finished the changes! Refreshing…"
                : phase === "error"
                  ? "Mochi hit a snag — try a different wording?"
                  : "Tell Mochi what to change. Plain words are fine."}
          </p>
        </div>

        {/* event log */}
        {(phase === "running" || phase === "done" || phase === "error") && events.length > 0 && (
          <div className="px-5 pb-3 flex-1 min-h-0 overflow-hidden">
            <AgentLog events={events} />
          </div>
        )}

        {phase === "error" && errorMessage && (
          <div className="mx-5 mb-3 rounded-2xl border border-mom/30 bg-mom-soft/40 p-3 text-[0.85rem] text-mom-ink">
            {errorMessage}
          </div>
        )}

        {/* composer */}
        <div className="px-3 sm:px-5 pt-2 mt-auto">
          <CreateComposer
            member={member}
            onSubmit={submit}
            disabled={phase === "running"}
            placeholder={`What should change, ${member.name}? (e.g. "make the buttons purple")`}
            submitLabel={phase === "running" ? "Working…" : "Change it"}
          />
        </div>
      </div>
    </>
  );
}
