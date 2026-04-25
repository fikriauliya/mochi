import type { App } from "@/lib/types";
import type { FamilyMember } from "@/lib/family";
import { Mochi } from "./Mochi";
import { AppCard } from "./AppCard";
import { CreateComposer } from "./CreateComposer";

type Props = {
  member: FamilyMember;
  apps: App[];
  loading: boolean;
  onCreate: (prompt: string) => void;
  onOpen: (id: string) => void;
  onModify: (id: string) => void;
};

export function AppLibrary({
  member,
  apps,
  loading,
  onCreate,
  onOpen,
  onModify,
}: Props) {
  // Newest first
  const sorted = [...apps].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Hero + composer */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 mb-6 sm:mb-8 rise-in">
          <Mochi size={96} happy className="sm:hidden" />
          <Mochi size={120} happy className="hidden sm:inline-flex" />
          <div className="leading-tight">
            <div className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint mb-2">
              Family kitchen
            </div>
            <h2
              className="font-display text-[1.8rem] sm:text-[2.2rem] lg:text-[2.6rem] leading-[1.05] text-ink"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}
            >
              Hi {member.name}.{" "}
              <span className="italic text-ink-soft">What shall we make?</span>
            </h2>
          </div>
        </div>

        <div className="rise-in" style={{ animationDelay: "100ms" }}>
          <CreateComposer member={member} onSubmit={onCreate} />
        </div>

        {/* Library grid */}
        <div className="mt-10 rise-in" style={{ animationDelay: "200ms" }}>
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-[0.72rem] uppercase tracking-[0.18em] text-ink-faint">
              Family apps
            </h3>
            <span className="text-[0.78rem] text-ink-faint italic">
              {apps.length} {apps.length === 1 ? "app" : "apps"}
            </span>
          </div>

          {loading ? (
            <div className="text-ink-faint italic text-sm py-12 text-center">
              Looking at the shelves…
            </div>
          ) : sorted.length === 0 ? (
            <EmptyShelves />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sorted.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  onOpen={onOpen}
                  onModify={onModify}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyShelves() {
  return (
    <div className="rounded-3xl border-2 border-dashed border-line-strong/60 bg-paper/40 p-8 text-center">
      <div className="text-3xl mb-2">🍪</div>
      <p className="font-display text-xl text-ink-soft" style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "wght" 500' }}>
        Empty shelves — for now.
      </p>
      <p className="text-ink-faint italic text-sm mt-1">
        Tell Mochi what you want to build, and it'll appear here.
      </p>
    </div>
  );
}
