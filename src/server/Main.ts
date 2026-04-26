import { BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { BuildLive } from "./Build";
import { ClaudeLive } from "./Claude";
import { makeRoutes, type MochiServices } from "./HttpApi";
import { JobsLive } from "./Jobs";
import { OrganizeLive } from "./Organize";
import { PrintableLive } from "./Printable";
import { RegistryLive } from "./Registry";
import { VoiceLive } from "./Voice";

// Registry, Claude, Build, Printable, Organize, and Voice are siblings;
// Jobs consumes only the first five (Voice is HTTP-only). Then everything
// is resolved against BunContext (FileSystem, Path, CommandExecutor).
const Siblings = Layer.mergeAll(
  RegistryLive,
  ClaudeLive,
  BuildLive,
  PrintableLive,
  OrganizeLive,
  VoiceLive,
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
    // Long-running SSE streams (build progress) idle for >10s while claude
    // thinks. Bun's default is 10s — bumping past the 15s heartbeat in
    // Sse.ts so the connection isn't reaped mid-build.
    idleTimeout: 60,
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
