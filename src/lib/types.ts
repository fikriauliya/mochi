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
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

/** `t` is ms elapsed since the job started, when known. */
export type BuildEvent =
  | { type: "status"; message: string; t?: number }
  | { type: "text"; text: string; t?: number }
  | { type: "tool"; tool: string; summary: string; t?: number }
  | { type: "tool_result"; tool: string; ok: boolean; summary: string; t?: number }
  | { type: "done"; t?: number }
  | { type: "error"; message: string; t?: number }
  | { type: "raw"; json: string; t?: number };
