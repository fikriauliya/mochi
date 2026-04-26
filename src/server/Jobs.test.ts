import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunContext } from "@effect/platform-bun";
import { Effect, Exit, Layer, Stream } from "effect";
import { BuildLive } from "./Build";
import { ClaudeService, type ClaudeError } from "./Claude";
import { JobsLive, JobsService, projectClaudeEvent } from "./Jobs";
import { NarratorService } from "./Narrator";
import { OrganizeService } from "./Organize";
import { PrintableError, PrintableService } from "./Printable";
import { makeRegistryLive, RegistryService } from "./Registry";
import type { App, ClaudeStreamEvent } from "./Schema";

// Tests never exercise the printable path (no OpenAI calls), but Jobs requires
// the service to be in scope. This stub fails loudly if accidentally invoked.
const StubPrintableLive = Layer.succeed(
  PrintableService,
  PrintableService.of({
    generatePng: () =>
      Effect.fail(
        new PrintableError({
          message: "PrintableService is not exercised in this test",
        }),
      ),
    generateMetadata: () =>
      Effect.fail(
        new PrintableError({
          message: "PrintableService is not exercised in this test",
        }),
      ),
  }),
);

// Organize never spawns claude in tests — return the input as one group
// so the per-id position assignment is exercised but no subprocess fires.
const StubOrganizeLive = Layer.succeed(
  OrganizeService,
  OrganizeService.of({
    organize: (apps) =>
      Effect.succeed([{ name: "", appIds: apps.map((a) => a.id) }]),
  }),
);

// Narrator: tests don't assert narration output, just that wiring works.
// Returning empty short-circuits the publish so the build stream stays clean.
const StubNarratorLive = Layer.succeed(
  NarratorService,
  NarratorService.of({
    narrate: () => Effect.succeed(""),
  }),
);

// ---------- Pure projection unit tests ----------

describe("projectClaudeEvent", () => {
  test("system/init → null (server log only, not user-visible)", () => {
    const ev = projectClaudeEvent({ type: "system", subtype: "init" });
    expect(ev).toBeNull();
  });

  test("assistant text block → text event", () => {
    const ev = projectClaudeEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    expect(ev).toEqual({ type: "text", text: "hello" });
  });

  test("assistant tool_use Write → tool event with file path summary", () => {
    const ev = projectClaudeEvent({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Write", input: { file_path: "apps/x/index.tsx" } },
        ],
      },
    });
    expect(ev).toEqual({
      type: "tool",
      tool: "Write",
      summary: "apps/x/index.tsx",
    });
  });

  test("assistant tool_use Bash → tool event with truncated command summary", () => {
    const longCmd = "echo " + "a".repeat(200);
    const ev = projectClaudeEvent({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command: longCmd } }],
      },
    });
    expect(ev?.type).toBe("tool");
    if (ev?.type === "tool") {
      expect(ev.tool).toBe("Bash");
      expect(ev.summary.length).toBeLessThanOrEqual(100);
    }
  });

  test("user tool_result success → tool_result ok", () => {
    const ev = projectClaudeEvent({
      type: "user",
      message: { content: [{ type: "tool_result", is_error: false, content: "yay" }] },
    });
    expect(ev).toMatchObject({ type: "tool_result", ok: true });
  });

  test("user tool_result error → tool_result fail with truncated content", () => {
    const ev = projectClaudeEvent({
      type: "user",
      message: { content: [{ type: "tool_result", is_error: true, content: "boom" }] },
    });
    expect(ev).toMatchObject({ type: "tool_result", ok: false, summary: "boom" });
  });

  test("result event → null (handled separately)", () => {
    expect(projectClaudeEvent({ type: "result", subtype: "success" })).toBeNull();
  });

  test("unknown event type → null", () => {
    expect(projectClaudeEvent({ type: "wat" })).toBeNull();
  });

  test("empty assistant text block → null (drops empty)", () => {
    expect(
      projectClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: "   " }] },
      }),
    ).toBeNull();
  });
});

// ---------- End-to-end Jobs flow with a mock ClaudeService ----------
//
// Jobs.runJob writes to `apps/<id>/` relative to process.cwd(). Tests run
// from the project root, so the path resolves there — same as production.
// We use a unique id per test and clean the dir up in afterEach. We can't
// chdir to /tmp because Bun.build needs to resolve react/react-dom, which
// only exist under the project's node_modules. (Hermetic-with-no-React
// fixtures sidestep that, but we also exercise BuildLive end-to-end.)

let dbPath: string;
const createdAppDirs: string[] = [];

beforeEach(() => {
  dbPath = join(tmpdir(), `mochi-jobs-${crypto.randomUUID()}.db`);
});
afterEach(() => {
  while (createdAppDirs.length) {
    const d = createdAppDirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
  for (const p of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (existsSync(p)) unlinkSync(p);
  }
});

const trackId = (id: string): string => {
  createdAppDirs.push(join("apps", id));
  return id;
};

// Plain TS in a .tsx file — no JSX or React imports — so Bun.build
// doesn't need to resolve any modules.
const goodTsx = `
const root = document.getElementById("root");
if (root) root.textContent = "hi";
`;
const goodManifest = JSON.stringify({
  name: "Counter",
  emoji: "🔢",
  description: "a tiny counter",
});

/**
 * Mock ClaudeService that synchronously runs `sideEffect(cwd)` (e.g. write
 * fixture files into the agent cwd) before returning a stream of synthesized
 * events. Lets Jobs.runJob exercise the manifest-read + bundle + registry
 * patches with no real claude subprocess.
 */
const MockClaudeLive = (
  events: ReadonlyArray<ClaudeStreamEvent>,
  sideEffect: (cwd: string) => void = () => {},
) =>
  Layer.succeed(
    ClaudeService,
    ClaudeService.of({
      spawn: ({ cwd }) =>
        Effect.sync(() => {
          sideEffect(cwd);
          return Stream.fromIterable(events) as Stream.Stream<
            ClaudeStreamEvent,
            ClaudeError
          >;
        }),
    }),
  );

const fakeStreamEvents: ReadonlyArray<ClaudeStreamEvent> = [
  { type: "system", subtype: "init" },
  {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Write", input: { file_path: "index.tsx" } },
      ],
    },
  },
  {
    type: "user",
    message: { content: [{ type: "tool_result", is_error: false, content: "ok" }] },
  },
  {
    type: "assistant",
    message: { content: [{ type: "text", text: "Done!" }] },
  },
  { type: "result", subtype: "success" },
];

const seedApp = (id: string): App => ({
  id,
  sessionId: crypto.randomUUID(),
  kind: "app",
  name: id,
  emoji: "🍡",
  description: "",
  prompt: "make a counter",
  status: "building",
  favorite: false,
  category: "",
  position: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const TestServices = (
  events: ReadonlyArray<ClaudeStreamEvent>,
  sideEffect?: (cwd: string) => void,
) =>
  JobsLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        makeRegistryLive(dbPath),
        MockClaudeLive(events, sideEffect),
        BuildLive,
        StubPrintableLive,
        StubOrganizeLive,
        StubNarratorLive,
      ),
    ),
    Layer.provideMerge(BunContext.layer),
  );

const provide = <A, E>(
  eff: Effect.Effect<A, E, JobsService | RegistryService>,
  layer: Layer.Layer<JobsService | RegistryService>,
) => Effect.runPromiseExit(eff.pipe(Effect.provide(layer)));

/**
 * Wait for the registry's status to leave "building" (or fail after `n`
 * polls). Used instead of subscribing to the PubSub because the daemon
 * fiber may publish events before our test can subscribe.
 */
const waitForTerminalStatus = (id: string, maxPolls = 200) =>
  Effect.gen(function* () {
    const r = yield* RegistryService;
    for (let i = 0; i < maxPolls; i++) {
      const app = yield* r.get(id);
      if (app.status !== "building") return app;
      yield* Effect.sleep("25 millis");
    }
    return yield* Effect.fail(new Error(`timed out waiting on ${id}`));
  });

describe("Jobs (end-to-end with mock claude)", () => {
  test("happy path: builds a fixture, bundles, registry → ready", async () => {
    const id = trackId(`counter-${crypto.randomUUID().slice(0, 4)}`);

    const layer = TestServices(fakeStreamEvents, (cwd) => {
      writeFileSync(join(cwd, "index.tsx"), goodTsx);
      writeFileSync(join(cwd, "manifest.json"), goodManifest);
    });

    const exit = await provide(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(seedApp(id));
        const j = yield* JobsService;
        yield* j.start(id, "create", "make a counter", "id-ID");
        return yield* waitForTerminalStatus(id);
      }),
      layer,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("ready");
      expect(exit.value.name).toBe("Counter");
      expect(exit.value.emoji).toBe("🔢");
      expect(exit.value.description).toBe("a tiny counter");
      expect(exit.value.lastError).toBeUndefined();
    }

    expect(existsSync(join("apps", id, "bundle.js"))).toBe(true);
    expect(existsSync(join("apps", id, "index.html"))).toBe(true);
  }, 15_000);

  test("missing manifest → status=error with helpful lastError", async () => {
    const id = trackId(`no-manifest-${crypto.randomUUID().slice(0, 4)}`);

    const layer = TestServices(fakeStreamEvents, (cwd) => {
      writeFileSync(join(cwd, "index.tsx"), goodTsx);
    });

    const exit = await provide(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(seedApp(id));
        const j = yield* JobsService;
        yield* j.start(id, "create", "make a counter", "id-ID");
        return yield* waitForTerminalStatus(id);
      }),
      layer,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("error");
      expect(exit.value.lastError).toContain("manifest.json missing");
    }
  }, 15_000);

  test("invalid manifest JSON → status=error", async () => {
    const id = trackId(`bad-manifest-${crypto.randomUUID().slice(0, 4)}`);

    const layer = TestServices(fakeStreamEvents, (cwd) => {
      writeFileSync(join(cwd, "index.tsx"), goodTsx);
      writeFileSync(join(cwd, "manifest.json"), "{not json");
    });

    const exit = await provide(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(seedApp(id));
        const j = yield* JobsService;
        yield* j.start(id, "create", "x", "id-ID");
        return yield* waitForTerminalStatus(id);
      }),
      layer,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("error");
      expect(exit.value.lastError).toContain("manifest.json is not valid JSON");
    }
  }, 15_000);

  test("manifest schema mismatch → status=error", async () => {
    const id = trackId(`bad-schema-${crypto.randomUUID().slice(0, 4)}`);

    const layer = TestServices(fakeStreamEvents, (cwd) => {
      writeFileSync(join(cwd, "index.tsx"), goodTsx);
      writeFileSync(join(cwd, "manifest.json"), JSON.stringify({ name: "" }));
    });

    const exit = await provide(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(seedApp(id));
        const j = yield* JobsService;
        yield* j.start(id, "create", "x", "id-ID");
        return yield* waitForTerminalStatus(id);
      }),
      layer,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("error");
      expect(exit.value.lastError).toContain("manifest.json failed schema");
    }
  }, 15_000);

  test("starting a second job for the same id while one runs → JobAlreadyRunning", async () => {
    const id = trackId(`double-${crypto.randomUUID().slice(0, 4)}`);

    // Use a never-ending stream so the first job stays in flight long
    // enough for us to call start() twice.
    const layer = JobsLive.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          makeRegistryLive(dbPath),
          Layer.succeed(
            ClaudeService,
            ClaudeService.of({
              spawn: () =>
                Effect.sync(
                  () => Stream.never as Stream.Stream<ClaudeStreamEvent, ClaudeError>,
                ),
            }),
          ),
          BuildLive,
          StubPrintableLive,
          StubOrganizeLive,
          StubNarratorLive,
        ),
      ),
      Layer.provideMerge(BunContext.layer),
    );

    const exit = await provide(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(seedApp(id));
        const j = yield* JobsService;
        yield* j.start(id, "create", "x", "id-ID");
        yield* Effect.sleep("50 millis");
        return yield* j.start(id, "create", "again", "id-ID").pipe(
          Effect.catchTag("JobAlreadyRunning", (e) => Effect.succeed(e._tag)),
        );
      }),
      layer,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe("JobAlreadyRunning");
    }
  }, 10_000);

  test("subscribe replays terminal `done` from registry when no active job", async () => {
    const id = "ready-ffff";
    const layer = TestServices([]);

    const exit = await provide(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert({
          ...seedApp(id),
          status: "ready",
        });
        const j = yield* JobsService;
        return yield* j.subscribe(id).pipe(Stream.runCollect);
      }),
      layer,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const arr = Array.from(exit.value);
      expect(arr.length).toBe(1);
      expect(arr[0]?.type).toBe("done");
    }
  });

  test("subscribe replays terminal `error` with lastError from registry", async () => {
    const id = "errored-gggg";
    const layer = TestServices([]);

    const exit = await provide(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert({
          ...seedApp(id),
          status: "error",
          lastError: "old failure",
        });
        const j = yield* JobsService;
        return yield* j.subscribe(id).pipe(Stream.runCollect);
      }),
      layer,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const arr = Array.from(exit.value);
      expect(arr.length).toBe(1);
      expect(arr[0]).toMatchObject({ type: "error", message: "old failure" });
    }
  });
});
