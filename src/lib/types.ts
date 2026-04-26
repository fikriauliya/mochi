export type AppStatus = "building" | "ready" | "error";
export type AppKind = "app" | "printable";

/** Mirror of src/server/Schema.ts App. */
export type App = {
  id: string;
  sessionId: string;
  kind: AppKind;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
  status: AppStatus;
  favorite: boolean;
  /** Category label assigned by the organize service ("" until organized). */
  category: string;
  /** Lower = earlier within its category. Set by the organize service. */
  position: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

export type SpeechLang = "id-ID" | "en-US";

/** `t` is ms elapsed since the job started, when known. */
export type BuildEvent =
  | { type: "status"; message: string; t?: number }
  | { type: "text"; text: string; t?: number }
  | { type: "tool"; tool: string; summary: string; t?: number }
  | { type: "tool_result"; tool: string; ok: boolean; summary: string; t?: number }
  | { type: "done"; t?: number }
  | { type: "error"; message: string; t?: number }
  | { type: "raw"; json: string; t?: number };

/**
 * Every value of `BuildEvent.type`. Kept here so `lib/api.ts` can register
 * SSE listeners by iteration; if you add a new variant above, this list is
 * checked for exhaustiveness via the satisfies clause.
 */
export const BUILD_EVENT_TYPES: ReadonlyArray<BuildEvent["type"]> = [
  "status",
  "text",
  "tool",
  "tool_result",
  "done",
  "error",
  "raw",
] as const satisfies ReadonlyArray<BuildEvent["type"]>;
