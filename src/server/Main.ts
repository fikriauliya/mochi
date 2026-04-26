import { BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { BuildLive } from "./Build";
import { ClaudeLive } from "./Claude";
import { makeRoutes, type MochiServices } from "./HttpApi";
import { JobsLive } from "./Jobs";
import { PrintableLive } from "./Printable";
import { RegistryLive } from "./Registry";

// Registry, Claude, Build, and Printable are siblings; Jobs consumes all of
// them. Then everything is resolved against BunContext (FileSystem, Path,
// CommandExecutor).
const Siblings = Layer.mergeAll(
  RegistryLive,
  ClaudeLive,
  BuildLive,
  PrintableLive,
);

/** All services composed into a single Layer for the runtime. */
export const MainLive = JobsLive.pipe(
  Layer.provideMerge(Siblings),
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
