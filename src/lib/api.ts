import type { App, AppKind, BuildEvent } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body && typeof body === "object" && "error" in body) {
        detail = String((body as { error: unknown }).error);
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const listApps = (): Promise<App[]> =>
  fetch("/api/apps").then((r) => asJson<App[]>(r));

export const getApp = (id: string): Promise<App> =>
  fetch(`/api/apps/${encodeURIComponent(id)}`).then((r) => asJson<App>(r));

export const createApp = (input: {
  prompt: string;
  kind?: AppKind;
}): Promise<App> =>
  fetch("/api/apps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => asJson<App>(r));

export const modifyApp = (
  id: string,
  input: { prompt: string },
): Promise<App> =>
  fetch(`/api/apps/${encodeURIComponent(id)}/modify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => asJson<App>(r));

export const deleteApp = (id: string): Promise<void> =>
  fetch(`/api/apps/${encodeURIComponent(id)}`, { method: "DELETE" }).then(
    (res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    },
  );

/**
 * Subscribe to a build/modify SSE stream. Returns an `unsubscribe` function.
 * `onEvent` is called for each typed `BuildEvent`; `onError` is invoked on
 * connection error or stream close before a terminal event.
 */
export function subscribeStream(
  appId: string,
  onEvent: (event: BuildEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = `/api/apps/${encodeURIComponent(appId)}/stream`;
  const source = new EventSource(url);

  const handler = (kind: BuildEvent["type"]) => (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as BuildEvent;
      onEvent(data);
      if (kind === "done" || kind === "error") {
        source.close();
      }
    } catch {
      // ignore malformed line
    }
  };

  source.addEventListener("status", handler("status") as EventListener);
  source.addEventListener("text", handler("text") as EventListener);
  source.addEventListener("tool", handler("tool") as EventListener);
  source.addEventListener("tool_result", handler("tool_result") as EventListener);
  source.addEventListener("done", handler("done") as EventListener);
  source.addEventListener("error", handler("error") as EventListener);

  source.onerror = (e) => {
    if (onError) onError(e);
  };

  return () => source.close();
}
