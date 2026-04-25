import { BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { ClaudeLive } from "./Claude";
import { makeRoutes, type MochiServices } from "./HttpApi";
import { JobsLive } from "./Jobs";
import { RegistryLive } from "./Registry";

// Registry and Claude are siblings; Jobs consumes both. Then everything is
// resolved against BunContext (FileSystem, Path, CommandExecutor).
const RegistryAndClaude = Layer.merge(RegistryLive, ClaudeLive);

/** All services composed into a single Layer for the runtime. */
export const MainLive = JobsLive.pipe(
  Layer.provideMerge(RegistryAndClaude),
  Layer.provideMerge(BunContext.layer),
);

/**
 * Boots Bun.serve with handlers backed by the current Effect runtime, then
 * idles forever. Cancellation closes the scope which stops the server.
 */
export const runServer = Effect.gen(function* () {
  const runtime = yield* Effect.runtime<MochiServices>();

  const server = Bun.serve({
    routes: makeRoutes(runtime) as never,
    development:
      process.env.NODE_ENV !== "production"
        ? { hmr: true, console: true }
        : false,
  });

  yield* Effect.logInfo(`🍡 Mochi running at ${server.url}`);

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      server.stop();
    }),
  );
  yield* Effect.never;
});
