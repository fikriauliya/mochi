import { Context, Data, Effect, Layer, Ref, Schema as S } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { App } from "./Schema";

export class RegistryError extends Data.TaggedError("RegistryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AppNotFound extends Data.TaggedError("AppNotFound")<{
  readonly id: string;
}> {}

export class RegistryService extends Context.Tag("RegistryService")<
  RegistryService,
  {
    readonly list: Effect.Effect<ReadonlyArray<App>, RegistryError>;
    readonly get: (id: string) => Effect.Effect<App, AppNotFound | RegistryError>;
    readonly upsert: (app: App) => Effect.Effect<App, RegistryError>;
    readonly patch: (
      id: string,
      patch: Partial<App>,
    ) => Effect.Effect<App, AppNotFound | RegistryError>;
    readonly remove: (id: string) => Effect.Effect<void, RegistryError>;
  }
>() {}

const REGISTRY_DIR = "apps";
const REGISTRY_FILE = "registry.json";

const decodeApps = S.decodeUnknown(S.Array(App));

export const RegistryLive = Layer.scoped(
  RegistryService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sema = yield* Effect.makeSemaphore(1);
    const ref = yield* Ref.make<ReadonlyArray<App>>([]);

    const file = path.join(REGISTRY_DIR, REGISTRY_FILE);
    const tmpFile = path.join(REGISTRY_DIR, `${REGISTRY_FILE}.tmp`);

    // ensure apps/ exists; tolerate already-existing
    yield* fs.makeDirectory(REGISTRY_DIR, { recursive: true }).pipe(Effect.ignore);

    // initial load
    yield* Effect.gen(function* () {
      const exists = yield* fs.exists(file);
      if (!exists) return;
      const text = yield* fs.readFileString(file);
      const json = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) => new RegistryError({ message: "registry.json is not valid JSON", cause }),
      });
      const apps = yield* decodeApps(json).pipe(
        Effect.mapError(
          (e) => new RegistryError({ message: "registry.json failed schema check", cause: e }),
        ),
      );
      yield* Ref.set(ref, apps);
    }).pipe(
      Effect.catchTag("RegistryError", (e) =>
        Effect.logWarning(`Registry load failed: ${e.message}; starting with empty registry`),
      ),
    );

    const persist = (next: ReadonlyArray<App>) =>
      sema.withPermits(1)(
        Effect.gen(function* () {
          const text = JSON.stringify(next, null, 2);
          yield* fs.writeFileString(tmpFile, text).pipe(
            Effect.mapError(
              (cause) => new RegistryError({ message: "write tmp registry failed", cause }),
            ),
          );
          yield* fs.rename(tmpFile, file).pipe(
            Effect.mapError(
              (cause) => new RegistryError({ message: "rename registry failed", cause }),
            ),
          );
          yield* Ref.set(ref, next);
        }),
      );

    return RegistryService.of({
      list: Ref.get(ref),
      get: (id) =>
        Ref.get(ref).pipe(
          Effect.flatMap((arr) => {
            const found = arr.find((a) => a.id === id);
            return found ? Effect.succeed(found) : Effect.fail(new AppNotFound({ id }));
          }),
        ),
      upsert: (app) =>
        Effect.gen(function* () {
          const arr = yield* Ref.get(ref);
          const existing = arr.find((a) => a.id === app.id);
          const next = existing
            ? arr.map((a) => (a.id === app.id ? app : a))
            : [...arr, app];
          yield* persist(next);
          return app;
        }),
      patch: (id, patch) =>
        Effect.gen(function* () {
          const arr = yield* Ref.get(ref);
          const existing = arr.find((a) => a.id === id);
          if (!existing) return yield* Effect.fail(new AppNotFound({ id }));
          const merged: App = { ...existing, ...patch, updatedAt: Date.now() };
          const next = arr.map((a) => (a.id === id ? merged : a));
          yield* persist(next);
          return merged;
        }),
      remove: (id) =>
        Effect.gen(function* () {
          const arr = yield* Ref.get(ref);
          const next = arr.filter((a) => a.id !== id);
          if (next.length === arr.length) return; // idempotent
          yield* persist(next);
        }),
    });
  }),
);
