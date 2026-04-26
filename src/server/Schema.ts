import { Schema as S } from "effect";

export const AppStatus = S.Literal("building", "ready", "error");
export type AppStatus = S.Schema.Type<typeof AppStatus>;

/**
 * Output kind: an interactive web app (claude generates index.tsx)
 * vs a static printable infographic (gpt-image-2 generates print.png).
 */
export const AppKind = S.Literal("app", "printable");
export type AppKind = S.Schema.Type<typeof AppKind>;

/** The on-disk shape of one app entry in apps/registry.json. */
export const App = S.Struct({
  id: S.String,
  sessionId: S.String,
  kind: AppKind,
  name: S.String,
  emoji: S.String,
  description: S.String,
  prompt: S.String,
  status: AppStatus,
  favorite: S.Boolean,
  /**
   * Category label assigned by the organize service ("Kid Games",
   * "Daily Routines", etc). Empty until the first organize run; the
   * frontend treats empty as "Other".
   */
  category: S.String,
  /** Lower = earlier within its category on the home grid. */
  position: S.Number,
  createdAt: S.Number,
  updatedAt: S.Number,
  lastError: S.optional(S.String),
});
export type App = S.Schema.Type<typeof App>;

/** Body of PATCH /api/apps/:id — currently only favorite is user-settable. */
export const PatchAppRequest = S.Struct({
  favorite: S.optional(S.Boolean),
});
export type PatchAppRequest = S.Schema.Type<typeof PatchAppRequest>;

/**
 * Body of POST /api/apps. `kind` is optional; legacy clients posting just
 * `{ prompt }` continue to get an interactive app.
 */
export const CreateAppRequest = S.Struct({
  prompt: S.String.pipe(S.minLength(1), S.maxLength(2000)),
  kind: S.optional(AppKind),
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

/**
 * Lean event sent to the browser over SSE. Each variant carries an optional
 * `t` (ms since the job started) so the UI can render a relative timeline
 * and we can diagnose where build time goes. Replayed terminal events from
 * the registry omit `t` since the original timing is gone.
 */
const T = S.optional(S.Number);
export const BuildEvent = S.Union(
  S.Struct({ type: S.Literal("status"), message: S.String, t: T }),
  S.Struct({ type: S.Literal("text"), text: S.String, t: T }),
  S.Struct({ type: S.Literal("tool"), tool: S.String, summary: S.String, t: T }),
  S.Struct({ type: S.Literal("tool_result"), tool: S.String, ok: S.Boolean, summary: S.String, t: T }),
  S.Struct({ type: S.Literal("done"), t: T }),
  S.Struct({ type: S.Literal("error"), message: S.String, t: T }),
  // Full JSON of the original claude stream-json event. Always emitted
  // alongside the projection; the UI hides them unless verbose mode is on.
  S.Struct({ type: S.Literal("raw"), json: S.String, t: T }),
);
export type BuildEvent = S.Schema.Type<typeof BuildEvent>;

/** apps/<id>/manifest.json — the agent writes this. */
export const Manifest = S.Struct({
  name: S.String.pipe(S.minLength(1), S.maxLength(60)),
  emoji: S.String.pipe(S.minLength(1), S.maxLength(8)),
  description: S.String.pipe(S.maxLength(280)),
});
export type Manifest = S.Schema.Type<typeof Manifest>;
