import { Schema as S } from "effect";

export const FamilyId = S.Literal("dad", "mom", "aira", "kenji");
export type FamilyId = S.Schema.Type<typeof FamilyId>;

export const AppStatus = S.Literal("building", "ready", "error");
export type AppStatus = S.Schema.Type<typeof AppStatus>;

/** The on-disk shape of one app entry in apps/registry.json. */
export const App = S.Struct({
  id: S.String,
  sessionId: S.String,
  name: S.String,
  emoji: S.String,
  description: S.String,
  ownerId: FamilyId,
  prompt: S.String,
  status: AppStatus,
  createdAt: S.Number,
  updatedAt: S.Number,
  lastError: S.optional(S.String),
});
export type App = S.Schema.Type<typeof App>;

/** Body of POST /api/apps and POST /api/apps/:id/modify. */
export const CreateAppRequest = S.Struct({
  prompt: S.String.pipe(S.minLength(1), S.maxLength(2000)),
  ownerId: FamilyId,
});
export type CreateAppRequest = S.Schema.Type<typeof CreateAppRequest>;

export const ModifyAppRequest = CreateAppRequest;
export type ModifyAppRequest = CreateAppRequest;

/**
 * One line from `claude --output-format stream-json --include-partial-messages`.
 * We intentionally model it as a permissive record — the underlying schema is
 * complex and partly versioned. We narrow on the `type` discriminator inside
 * Jobs.ts when projecting to BuildEvent.
 */
export const ClaudeStreamEvent = S.Record({ key: S.String, value: S.Unknown });
export type ClaudeStreamEvent = S.Schema.Type<typeof ClaudeStreamEvent>;

/** Lean event sent to the browser over SSE. */
export const BuildEvent = S.Union(
  S.Struct({ type: S.Literal("status"), message: S.String }),
  S.Struct({ type: S.Literal("text"), text: S.String }),
  S.Struct({ type: S.Literal("tool"), tool: S.String, summary: S.String }),
  S.Struct({ type: S.Literal("tool_result"), tool: S.String, ok: S.Boolean, summary: S.String }),
  S.Struct({ type: S.Literal("done") }),
  S.Struct({ type: S.Literal("error"), message: S.String }),
);
export type BuildEvent = S.Schema.Type<typeof BuildEvent>;

/** apps/<id>/manifest.json — the agent writes this. */
export const Manifest = S.Struct({
  name: S.String.pipe(S.minLength(1), S.maxLength(60)),
  emoji: S.String.pipe(S.minLength(1), S.maxLength(8)),
  description: S.String.pipe(S.maxLength(280)),
});
export type Manifest = S.Schema.Type<typeof Manifest>;
