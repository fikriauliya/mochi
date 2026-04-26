import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunContext } from "@effect/platform-bun";
import { Effect, Exit, Layer } from "effect";
import { makeRegistryLive, RegistryService } from "./Registry";
import type { App } from "./Schema";

let dbPath: string;

const provideRegistry = <A, E>(eff: Effect.Effect<A, E, RegistryService>) =>
  Effect.runPromiseExit(
    eff.pipe(
      Effect.provide(makeRegistryLive(dbPath).pipe(Layer.provide(BunContext.layer))),
    ),
  );

const sample = (over: Partial<App> = {}): App => ({
  id: "test-1",
  sessionId: "sess-uuid",
  name: "Test",
  emoji: "🧪",
  description: "test app",
  prompt: "hi",
  status: "ready",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

beforeEach(() => {
  dbPath = join(tmpdir(), `mochi-reg-${crypto.randomUUID()}.db`);
});

afterEach(() => {
  for (const p of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best-effort
    }
  }
});

describe("Registry", () => {
  test("upsert + list returns the app", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(sample());
        return yield* r.list;
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.length).toBe(1);
      expect(exit.value[0]?.id).toBe("test-1");
    }
  });

  test("upsert is idempotent — overwrites on conflict", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(sample({ name: "First" }));
        yield* r.upsert(sample({ name: "Second" }));
        return yield* r.get("test-1");
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.name).toBe("Second");
    }
  });

  test("get returns AppNotFound for missing id", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        return yield* r.get("nope");
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Walk the cause to find the typed error
      const failures = JSON.stringify(exit.cause);
      expect(failures).toContain("AppNotFound");
    }
  });

  test("patch merges partial fields and bumps updatedAt", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(sample({ status: "building", updatedAt: 1 }));
        yield* Effect.sleep("2 millis");
        return yield* r.patch("test-1", { status: "ready", emoji: "🌟" });
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe("ready");
      expect(exit.value.emoji).toBe("🌟");
      expect(exit.value.name).toBe("Test"); // unchanged
      expect(exit.value.updatedAt).toBeGreaterThan(1);
    }
  });

  test("patch returns AppNotFound for missing id", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        return yield* r.patch("nope", { status: "ready" });
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failures = JSON.stringify(exit.cause);
      expect(failures).toContain("AppNotFound");
    }
  });

  test("remove deletes an app", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(sample());
        yield* r.remove("test-1");
        return yield* r.list;
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.length).toBe(0);
  });

  test("remove is a no-op for missing id (no error)", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.remove("nope");
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("list orders by created_at DESC", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(sample({ id: "a", createdAt: 1 }));
        yield* r.upsert(sample({ id: "b", createdAt: 3 }));
        yield* r.upsert(sample({ id: "c", createdAt: 2 }));
        return yield* r.list;
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.map((a) => a.id)).toEqual(["b", "c", "a"]);
    }
  });

  test("lastError round-trips through SQLite", async () => {
    const exit = await provideRegistry(
      Effect.gen(function* () {
        const r = yield* RegistryService;
        yield* r.upsert(sample({ status: "error", lastError: "uh oh" }));
        return yield* r.get("test-1");
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.lastError).toBe("uh oh");
    }
  });
});
