import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { MainLive, runServer } from "./server/Main";

BunRuntime.runMain(
  Effect.scoped(runServer).pipe(Effect.provide(MainLive)),
);

