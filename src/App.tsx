import * as React from "react";
import { ProfileRail } from "./components/ProfileRail";
import { ChatHeader } from "./components/ChatHeader";
import { AppLibrary } from "./components/AppLibrary";
import { BuildView } from "./components/BuildView";
import { OpenView } from "./components/OpenView";
import { KidShell } from "./components/KidShell";
import { createApp, listApps, getApp, modifyApp } from "./lib/api";
import { useKidMode } from "./lib/kidMode";
import type { App } from "./lib/types";
import "./index.css";

type View =
  | { kind: "home" }
  | { kind: "build"; appId: string }
  | { kind: "open"; appId: string };

function viewFromPath(pathname: string): View {
  const m1 = pathname.match(/^\/build\/([^/]+)\/?$/);
  if (m1 && m1[1]) return { kind: "build", appId: m1[1] };
  const m2 = pathname.match(/^\/open\/([^/]+)\/?$/);
  if (m2 && m2[1]) return { kind: "open", appId: m2[1] };
  return { kind: "home" };
}

function pathFromView(view: View): string {
  if (view.kind === "home") return "/";
  if (view.kind === "build") return `/build/${view.appId}`;
  return `/open/${view.appId}`;
}

export function App() {
  const [view, setView] = React.useState<View>(() =>
    viewFromPath(window.location.pathname),
  );
  const [apps, setApps] = React.useState<App[]>([]);
  const [appsLoading, setAppsLoading] = React.useState(true);
  const [railOpen, setRailOpen] = React.useState(false);
  const [kidMode, setKidMode] = useKidMode();

  // Sync view with the URL on browser back/forward
  React.useEffect(() => {
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = React.useCallback((next: View) => {
    const path = pathFromView(next);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    setView(next);
  }, []);

  // Close drawer on Escape and when crossing the md breakpoint upward
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailOpen(false);
    };
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => mq.matches && setRailOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onChange);
    };
  }, []);

  // Load apps on mount + after each build/modify completion
  const reload = React.useCallback(async () => {
    try {
      const next = await listApps();
      setApps(next);
    } catch {
      // ignore — empty state will be shown
    } finally {
      setAppsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // Resolve the current app from the loaded list (or fetch if missing)
  const [currentApp, setCurrentApp] = React.useState<App | null>(null);
  React.useEffect(() => {
    if (view.kind === "home") {
      setCurrentApp(null);
      return;
    }
    const fromList = apps.find((a) => a.id === view.appId);
    if (fromList) {
      setCurrentApp(fromList);
      return;
    }
    let cancelled = false;
    getApp(view.appId)
      .then((a) => {
        if (!cancelled) setCurrentApp(a);
      })
      .catch(() => {
        if (!cancelled) navigate({ kind: "home" });
      });
    return () => {
      cancelled = true;
    };
  }, [view, apps, navigate]);

  // ---- Actions ----

  const onCreate = React.useCallback(
    async (prompt: string) => {
      try {
        const app = await createApp({ prompt });
        setApps((cur) => [app, ...cur.filter((a) => a.id !== app.id)]);
        navigate({ kind: "build", appId: app.id });
      } catch (e) {
        console.error("createApp failed", e);
      }
    },
    [navigate],
  );

  const onOpenApp = React.useCallback(
    (id: string) => navigate({ kind: "open", appId: id }),
    [navigate],
  );

  const onModifyOpen = React.useCallback(
    (id: string) => navigate({ kind: "open", appId: id }),
    [navigate],
  );

  const onBuildDone = React.useCallback(
    async (id: string) => {
      await reload();
      navigate({ kind: "open", appId: id });
    },
    [navigate, reload],
  );

  const onRetryBuild = React.useCallback(async () => {
    if (view.kind !== "build" || !currentApp) return;
    try {
      const app = await modifyApp(currentApp.id, { prompt: currentApp.prompt });
      setCurrentApp(app);
      navigate({ kind: "home" });
      setTimeout(() => navigate({ kind: "build", appId: app.id }), 50);
    } catch (e) {
      console.error("retry failed", e);
    }
  }, [view, currentApp, navigate]);

  const onBackHome = React.useCallback(
    () => navigate({ kind: "home" }),
    [navigate],
  );

  // ---- Render ----

  if (kidMode) {
    return (
      <KidShell
        apps={apps}
        view={view}
        currentApp={currentApp}
        onCreate={onCreate}
        onOpenApp={onOpenApp}
        onBack={onBackHome}
        onExitKidMode={() => setKidMode(false)}
      />
    );
  }

  return (
    <div className="h-dvh w-screen flex overflow-hidden">
      <ProfileRail
        mobileOpen={railOpen}
        onMobileClose={() => setRailOpen(false)}
        apps={apps}
        onOpenApp={onOpenApp}
        onNewApp={onBackHome}
        onEnterKidMode={() => setKidMode(true)}
      />

      <main className="flex-1 flex flex-col min-w-0 relative">
        <ChatHeader
          onClear={onBackHome}
          hasMessages={view.kind !== "home"}
          onOpenRail={() => setRailOpen(true)}
        />

        {view.kind === "home" && (
          <AppLibrary
            apps={apps}
            loading={appsLoading}
            onCreate={onCreate}
            onOpen={onOpenApp}
            onModify={onModifyOpen}
          />
        )}

        {view.kind === "build" && currentApp && (
          <BuildView
            app={currentApp}
            onDone={onBuildDone}
            onBack={onBackHome}
            onRetry={onRetryBuild}
          />
        )}

        {view.kind === "open" && currentApp && (
          <OpenView app={currentApp} onBack={onBackHome} />
        )}

        {(view.kind === "build" || view.kind === "open") && !currentApp && (
          <div className="flex-1 flex items-center justify-center text-ink-faint italic">
            Loading…
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
