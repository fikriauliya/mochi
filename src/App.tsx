import * as React from "react";
import { KidShell } from "./components/KidShell";
import { createApp, getApp, listApps, modifyApp } from "./lib/api";
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

  const reload = React.useCallback(async () => {
    try {
      const next = await listApps();
      setApps(next);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // Refresh the apps list when returning home so deletes/builds reflect.
  React.useEffect(() => {
    if (view.kind === "home") reload();
  }, [view, reload]);

  // Resolve the current app from the cached list, or fetch on miss.
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

  const onModify = React.useCallback(
    async (id: string, prompt: string) => {
      try {
        const app = await modifyApp(id, { prompt });
        setApps((cur) => cur.map((a) => (a.id === id ? app : a)));
        navigate({ kind: "build", appId: id });
      } catch (e) {
        console.error("modifyApp failed", e);
      }
    },
    [navigate],
  );

  // Route based on the app's current status:
  //  - ready   → /open/:id (the iframe)
  //  - building → /build/:id (the live log so the user can watch progress)
  //  - error   → /build/:id (the build view shows the failure + retry)
  const onOpenApp = React.useCallback(
    (id: string) => {
      const app = apps.find((a) => a.id === id);
      const target: View =
        app && app.status !== "ready"
          ? { kind: "build", appId: id }
          : { kind: "open", appId: id };
      navigate(target);
    },
    [apps, navigate],
  );

  const onBackHome = React.useCallback(
    () => navigate({ kind: "home" }),
    [navigate],
  );

  const onBuildDone = React.useCallback(
    async (id: string) => {
      await reload();
      navigate({ kind: "open", appId: id });
    },
    [navigate, reload],
  );

  return (
    <KidShell
      apps={apps}
      view={view}
      currentApp={currentApp}
      onCreate={onCreate}
      onModify={onModify}
      onOpenApp={onOpenApp}
      onBack={onBackHome}
      onReload={reload}
      onBuildDone={onBuildDone}
    />
  );
}

export default App;
