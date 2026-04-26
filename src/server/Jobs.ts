import { FileSystem, Path } from "@effect/platform";
import {
  Context,
  Data,
  Effect,
  Fiber,
  Layer,
  Option,
  PubSub,
  Ref,
  Schema as S,
  Stream,
} from "effect";
import { BuildService } from "./Build";
import { ClaudeService, ClaudeError } from "./Claude";
import { computeCost, formatCost, type Usage } from "./Pricing";
import { PrintableService } from "./Printable";
import { AppNotFound, RegistryError, RegistryService } from "./Registry";
import {
  type App,
  type BuildEvent,
  type ClaudeStreamEvent,
  Manifest,
} from "./Schema";

export class JobAlreadyRunning extends Data.TaggedError("JobAlreadyRunning")<{
  readonly id: string;
}> {}

type JobKind = "create" | "modify";

type ActiveJob = {
  readonly pubsub: PubSub.PubSub<BuildEvent>;
  readonly fiber: Fiber.RuntimeFiber<unknown, unknown>;
  readonly terminal: Ref.Ref<Option.Option<BuildEvent>>;
};

export class JobsService extends Context.Tag("JobsService")<
  JobsService,
  {
    readonly start: (
      id: string,
      kind: JobKind,
      prompt: string,
    ) => Effect.Effect<void, JobAlreadyRunning | AppNotFound | RegistryError>;
    readonly subscribe: (id: string) => Stream.Stream<BuildEvent>;
  }
>() {}

const decodeManifest = S.decodeUnknown(Manifest);

/**
 * Project one raw claude stream-json event into a BuildEvent. The shape varies
 * by claude version; we extract the bits we care about and fall back gracefully
 * for anything else. Exported for unit testing.
 */
export function projectClaudeEvent(raw: ClaudeStreamEvent): BuildEvent | null {
  const type = (raw["type"] as string | undefined) ?? "";

  if (type === "assistant") {
    const message = raw["message"] as { content?: Array<unknown> } | undefined;
    const content = message?.content ?? [];
    for (const block of content) {
      const b = block as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
      if (b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0) {
        return { type: "text", text: b.text };
      }
      if (b.type === "tool_use" && typeof b.name === "string") {
        return {
          type: "tool",
          tool: b.name,
          summary: summarizeToolInput(b.name, b.input ?? {}),
        };
      }
    }
    return null;
  }

  if (type === "user") {
    const message = raw["message"] as { content?: Array<unknown> } | undefined;
    const content = message?.content ?? [];
    for (const block of content) {
      const b = block as {
        type?: string;
        tool_use_id?: string;
        is_error?: boolean;
        content?: unknown;
      };
      if (b.type === "tool_result") {
        const ok = !b.is_error;
        return {
          type: "tool_result",
          tool: "",
          ok,
          summary: ok ? "ok" : truncate(asText(b.content), 200),
        };
      }
    }
    return null;
  }

  if (type === "result") {
    // Terminal event handled separately by the stream-end logic; ignore here.
    return null;
  }

  // Unknown event types — quietly drop.
  return null;
}

function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  const path = input["file_path"] ?? input["path"];
  if (typeof path === "string") return path;
  if (tool === "Bash") {
    const cmd = input["command"];
    if (typeof cmd === "string") return truncate(cmd, 100);
  }
  return "";
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Static HTML shell used to render a printable PNG. Matches A4 portrait
 * with zero margin so `window.print()` produces a borderless full-bleed
 * page. The on-screen view scales the image to fit so it's also fine to
 * just look at in the iframe before printing.
 */
const printableHtmlTemplate = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fbf1e1; }
  body { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 1rem; box-sizing: border-box; }
  img { max-width: 100%; max-height: calc(100dvh - 2rem); width: auto; height: auto; box-shadow: 0 12px 32px -10px rgba(42,36,33,0.35); border-radius: 8px; background: #fff; }
  @media print {
    body { background: #fff; padding: 0; }
    img { width: 100vw; height: 100vh; max-width: none; max-height: none; object-fit: contain; box-shadow: none; border-radius: 0; }
  }
</style>
</head>
<body>
  <img src="./print.png" alt="${escapeHtml(title)}" />
</body>
</html>
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pull a short title out of the prompt — first line, max 60 chars. */
function deriveTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/)[0]?.trim() ?? prompt;
  return firstLine.slice(0, 60) || "Printable";
}

export const JobsLive = Layer.effect(
  JobsService,
  Effect.gen(function* () {
    const claude = yield* ClaudeService;
    const registry = yield* RegistryService;
    const builder = yield* BuildService;
    const printable = yield* PrintableService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const jobs = yield* Ref.make<ReadonlyMap<string, ActiveJob>>(new Map());

    const setJob = (id: string, job: ActiveJob) =>
      Ref.update(jobs, (m) => new Map(m).set(id, job));
    const clearJob = (id: string) =>
      Ref.update(jobs, (m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });

    const runJob = (
      id: string,
      kind: JobKind,
      prompt: string,
      app: App,
      pubsub: PubSub.PubSub<BuildEvent>,
      terminal: Ref.Ref<Option.Option<BuildEvent>>,
    ): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const t0 = Date.now();
        const elapsed = () => Date.now() - t0;
        const stamp = <E extends BuildEvent>(ev: E): E => ({ ...ev, t: elapsed() });
        const publish = (ev: BuildEvent) => pubsub.publish(stamp(ev));

        const cwd = path.join("apps", id);
        yield* fs.makeDirectory(cwd, { recursive: true }).pipe(Effect.ignore);

        yield* Effect.log(
          `[build ${id}] start kind=${kind} outputKind=${app.kind} promptLen=${prompt.length}`,
        );

        // ---- PRINTABLE PATH ----
        // No claude subprocess; we call OpenAI gpt-image-2 directly, save
        // the PNG, and synthesize index.html + manifest.json so the rest
        // of the system (registry status, /apps/:id/* serving, the open
        // view) treats it identically to a real app.
        if (app.kind === "printable") {
          // On modify, accumulate the prompt history so the model can see
          // both the original subject and the requested change. There's
          // no `--resume` for image generation, so the alternative would
          // be regenerating from scratch and losing context.
          const fullPrompt =
            kind === "modify" && app.prompt
              ? `${app.prompt}\n\nNow also: ${prompt}`
              : prompt;

          yield* publish({
            type: "status",
            message:
              kind === "modify"
                ? "Mochi is sketching an updated version…"
                : "Mochi is sketching your printable…",
          });

          // Image and metadata are independent OpenAI calls — fan them out.
          // Image dominates the wall clock (~10s); metadata (~1-2s) hides
          // entirely behind it. On metadata failure we fall back to a
          // server-derived title so the printable still ships.
          const tStart = Date.now();
          const { png, manifest } = yield* Effect.all(
            {
              png: printable.generatePng(fullPrompt),
              manifest: printable.generateMetadata(fullPrompt).pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    `[build ${id}] metadata gen failed: ${cause.message} — using derived title`,
                  ),
                ),
                Effect.orElseSucceed(() => ({
                  name: deriveTitle(fullPrompt),
                  emoji: "🖨",
                  description: fullPrompt.slice(0, 280),
                })),
              ),
            },
            { concurrency: 2 },
          );
          yield* Effect.log(
            `[build ${id}] gpt-image-2 + gpt-4o-mini returned in ${Date.now() - tStart}ms (${png.byteLength} bytes)`,
          );

          yield* fs
            .writeFile(path.join(cwd, "print.png"), png)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ClaudeError({
                    message: "failed to write print.png",
                    cause,
                  }),
              ),
            );

          yield* fs
            .writeFileString(
              path.join(cwd, "index.html"),
              printableHtmlTemplate(manifest.name),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ClaudeError({
                    message: "failed to write index.html",
                    cause,
                  }),
              ),
            );
          yield* fs
            .writeFileString(
              path.join(cwd, "manifest.json"),
              JSON.stringify(manifest, null, 2),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ClaudeError({
                    message: "failed to write manifest.json",
                    cause,
                  }),
              ),
            );

          yield* registry.patch(id, {
            name: manifest.name,
            emoji: manifest.emoji,
            description: manifest.description,
            prompt: fullPrompt,
            status: "ready",
            lastError: undefined,
          });

          const total = elapsed();
          yield* Effect.log(`[build ${id}] DONE total=${total}ms (printable)`);
          const done: BuildEvent = stamp({ type: "done" });
          yield* Ref.set(terminal, Option.some(done));
          yield* pubsub.publish(done);
          return;
        }

        // ---- APP PATH (existing claude flow) ----
        const sessionId = app.sessionId;

        // Open Claude stream
        const tSpawnStart = Date.now();
        const stream = yield* claude.spawn({
          cwd,
          sessionId,
          resume: kind === "modify",
          prompt,
        });
        yield* Effect.log(
          `[build ${id}] claude spawned in ${Date.now() - tSpawnStart}ms`,
        );

        // Fanout each event. We always publish a `raw` event with the
        // full JSON for debug/verbose mode, then publish the projected
        // kid-friendly event if the projector recognised it. We also
        // record TTFT and per-tool timings into the server log for
        // post-hoc analysis of slow builds, and surface API cost from
        // the terminal `result` event.
        let firstEventAt: number | null = null;
        let lastToolStartAt: number | null = null;
        let lastToolName: string | null = null;
        let currentModel = "";
        yield* stream.pipe(
          Stream.runForEach((raw) =>
            Effect.gen(function* () {
              if (firstEventAt === null) {
                firstEventAt = Date.now();
                yield* Effect.log(
                  `[build ${id}] claude TTFT ${firstEventAt - t0}ms`,
                );
              }
              yield* publish({ type: "raw", json: JSON.stringify(raw) });

              // Capture the model id from the system/init preamble so we
              // can price the result event when it arrives. Some claude
              // versions also stamp `model` directly on the result.
              const rawType = raw["type"];
              const rawSubtype = raw["subtype"];
              if (rawType === "system" && rawSubtype === "init") {
                const m = raw["model"];
                if (typeof m === "string") currentModel = m;
              }
              if (rawType === "result") {
                const fallbackModel =
                  typeof raw["model"] === "string"
                    ? (raw["model"] as string)
                    : currentModel;
                const usage = raw["usage"] as Usage | undefined;
                if (usage && fallbackModel) {
                  const cost = computeCost(fallbackModel, usage);
                  if (cost) {
                    const line = formatCost(cost);
                    yield* Effect.log(`[build ${id}] ${line}`);
                    yield* publish({ type: "status", message: line });
                  } else {
                    yield* Effect.log(
                      `[build ${id}] cost: unknown rates for model ${fallbackModel}`,
                    );
                  }
                }
              }

              const ev = projectClaudeEvent(raw);
              if (ev) {
                if (ev.type === "tool") {
                  lastToolStartAt = Date.now();
                  lastToolName = ev.tool;
                  yield* Effect.log(
                    `[build ${id}] tool ${ev.tool} ${ev.summary} (+${elapsed()}ms)`,
                  );
                } else if (ev.type === "tool_result" && lastToolStartAt) {
                  const took = Date.now() - lastToolStartAt;
                  yield* Effect.log(
                    `[build ${id}] tool ${lastToolName ?? "?"} ${ev.ok ? "ok" : "fail"} in ${took}ms`,
                  );
                  lastToolStartAt = null;
                }
                yield* publish(ev);
              }
            }),
          ),
        );

        const tClaudeEnd = Date.now();
        yield* Effect.log(
          `[build ${id}] claude stream ended after ${tClaudeEnd - t0}ms`,
        );

        // ----- Subprocess succeeded → read manifest -----
        // We always re-read on modify too, so an agent that updates the
        // manifest (e.g. picks a better emoji or rename) flows through.
        const tManifestStart = Date.now();
        const manifestPath = path.join(cwd, "manifest.json");
        const manifestText = yield* fs.readFileString(manifestPath).pipe(
          Effect.mapError(
            (cause) =>
              new ClaudeError({
                message:
                  kind === "create"
                    ? "manifest.json missing after build"
                    : "manifest.json missing — was it deleted?",
                cause,
              }),
          ),
        );
        const manifestJson = yield* Effect.try({
          try: () => JSON.parse(manifestText) as unknown,
          catch: (cause) =>
            new ClaudeError({
              message: "manifest.json is not valid JSON",
              cause,
            }),
        });
        const manifest = yield* decodeManifest(manifestJson).pipe(
          Effect.mapError(
            (cause) =>
              new ClaudeError({
                message: "manifest.json failed schema",
                cause,
              }),
          ),
        );
        yield* Effect.log(
          `[build ${id}] manifest read in ${Date.now() - tManifestStart}ms`,
        );

        // ----- Bundle index.tsx -----
        const tBundleStart = Date.now();
        yield* builder.bundle(cwd, manifest.name);
        const bundleMs = Date.now() - tBundleStart;
        yield* Effect.log(`[build ${id}] bundle in ${bundleMs}ms`);

        // ----- Persist + announce ready -----
        yield* registry.patch(id, {
          name: manifest.name,
          emoji: manifest.emoji,
          description: manifest.description,
          status: "ready",
          lastError: undefined,
        });

        const total = elapsed();
        yield* Effect.log(
          `[build ${id}] DONE total=${total}ms (claude=${tClaudeEnd - t0}ms bundle=${bundleMs}ms)`,
        );

        const done: BuildEvent = stamp({ type: "done" });
        yield* Ref.set(terminal, Option.some(done));
        yield* pubsub.publish(done);
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.gen(function* () {
            const headline =
              cause && typeof cause === "object" && "message" in cause
                ? String((cause as { message: unknown }).message)
                : "build failed";
            const detail =
              cause && typeof cause === "object" && "logs" in cause
                ? `${headline}\n${String((cause as { logs: unknown }).logs ?? "").slice(0, 1500)}`
                : headline;
            const ev: BuildEvent = { type: "error", message: detail };
            yield* Effect.logError(`[build ${id}] FAILED: ${headline}`);
            yield* registry
              .patch(id, { status: "error", lastError: detail })
              .pipe(Effect.ignore);
            yield* Ref.set(terminal, Option.some(ev));
            yield* pubsub.publish(ev);
          }),
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            // Drain pubsub; subscribers will hit end-of-stream after the terminal
            // event is emitted. We delay shutdown a tick so subscribers that
            // joined moments before terminal still receive it.
            yield* Effect.sleep("250 millis");
            yield* pubsub.shutdown;
            yield* clearJob(id);
          }),
        ),
        Effect.scoped,
      );

    return JobsService.of({
      start: (id, kind, prompt) =>
        Effect.gen(function* () {
          const existing = (yield* Ref.get(jobs)).get(id);
          if (existing) return yield* Effect.fail(new JobAlreadyRunning({ id }));

          const app = yield* registry.get(id);
          const pubsub = yield* PubSub.unbounded<BuildEvent>();
          const terminal = yield* Ref.make<Option.Option<BuildEvent>>(Option.none());

          // mark building (idempotent)
          yield* registry
            .patch(id, { status: "building", lastError: undefined })
            .pipe(Effect.ignore);

          const fiber = yield* Effect.forkDaemon(
            runJob(id, kind, prompt, app, pubsub, terminal),
          );
          yield* setJob(id, { pubsub, fiber, terminal });
        }),
      subscribe: (id) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const job = (yield* Ref.get(jobs)).get(id);
            if (job) {
              return Stream.fromPubSub(job.pubsub);
            }
            // No active job — replay one terminal event from the registry so
            // late subscribers (e.g. EventSource reconnects after build end)
            // see a clean close instead of an empty stream that browsers
            // interpret as a network drop.
            const app = yield* registry.get(id).pipe(
              Effect.catchAll(() => Effect.succeed(null)),
            );
            if (!app) return Stream.empty as Stream.Stream<BuildEvent>;
            const terminal: BuildEvent =
              app.status === "ready"
                ? { type: "done" }
                : app.status === "error"
                  ? { type: "error", message: app.lastError ?? "build failed" }
                  : { type: "status", message: "still building…" };
            return Stream.succeed(terminal) as Stream.Stream<BuildEvent>;
          }),
        ),
    });
  }),
);
