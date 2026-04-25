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
import { ClaudeService, ClaudeError } from "./Claude";
import { AppNotFound, RegistryError, RegistryService } from "./Registry";
import {
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

const nowStatus = (msg: string): BuildEvent => ({ type: "status", message: msg });

/**
 * Project one raw claude stream-json event into a BuildEvent. The shape varies
 * by claude version; we extract the bits we care about and fall back gracefully
 * for anything else.
 */
function projectClaudeEvent(raw: ClaudeStreamEvent): BuildEvent | null {
  const type = (raw["type"] as string | undefined) ?? "";
  const subtype = (raw["subtype"] as string | undefined) ?? "";

  if (type === "system" && subtype === "init") {
    return nowStatus("Mochi is preparing the kitchen…");
  }

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

export const JobsLive = Layer.effect(
  JobsService,
  Effect.gen(function* () {
    const claude = yield* ClaudeService;
    const registry = yield* RegistryService;
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
      sessionId: string,
      pubsub: PubSub.PubSub<BuildEvent>,
      terminal: Ref.Ref<Option.Option<BuildEvent>>,
    ): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const cwd = path.join("apps", id);
        yield* fs.makeDirectory(cwd, { recursive: true }).pipe(Effect.ignore);

        // Open Claude stream
        const stream = yield* claude.spawn({
          cwd,
          sessionId,
          resume: kind === "modify",
          prompt,
        });

        // Fanout each projected event
        yield* stream.pipe(
          Stream.runForEach((raw) => {
            const ev = projectClaudeEvent(raw);
            return ev ? pubsub.publish(ev) : Effect.void;
          }),
        );

        // Subprocess succeeded → read manifest (only on create; modify keeps prior name)
        if (kind === "create") {
          const manifestPath = path.join(cwd, "manifest.json");
          const text = yield* fs.readFileString(manifestPath).pipe(
            Effect.mapError(
              (cause) =>
                new ClaudeError({
                  message: "manifest.json missing after build",
                  cause,
                }),
            ),
          );
          const json = yield* Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: (cause) =>
              new ClaudeError({ message: "manifest.json invalid JSON", cause }),
          });
          const manifest = yield* decodeManifest(json).pipe(
            Effect.mapError(
              (cause) =>
                new ClaudeError({ message: "manifest.json failed schema", cause }),
            ),
          );
          yield* registry.patch(id, {
            name: manifest.name,
            emoji: manifest.emoji,
            description: manifest.description,
            status: "ready",
            lastError: undefined,
          });
        } else {
          yield* registry.patch(id, { status: "ready", lastError: undefined });
        }

        const done: BuildEvent = { type: "done" };
        yield* Ref.set(terminal, Option.some(done));
        yield* pubsub.publish(done);
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.gen(function* () {
            const message =
              "message" in (cause as object) ? String((cause as { message: unknown }).message) : "build failed";
            const ev: BuildEvent = { type: "error", message };
            yield* registry
              .patch(id, { status: "error", lastError: message })
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
            runJob(id, kind, prompt, app.sessionId, pubsub, terminal),
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
