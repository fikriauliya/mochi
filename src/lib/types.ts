import type { FamilyId } from "./family";

export type AppStatus = "building" | "ready" | "error";

/** Mirror of src/server/Schema.ts App. */
export type App = {
  id: string;
  sessionId: string;
  name: string;
  emoji: string;
  description: string;
  ownerId: FamilyId;
  prompt: string;
  status: AppStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

export type BuildEvent =
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; summary: string }
  | { type: "tool_result"; tool: string; ok: boolean; summary: string }
  | { type: "done" }
  | { type: "error"; message: string };
