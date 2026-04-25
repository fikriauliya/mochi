import { Command, CommandExecutor } from "@effect/platform";
import { Context, Data, Effect, Layer, Ref, Schema as S, Scope, Stream } from "effect";
import { ClaudeStreamEvent } from "./Schema";

export class ClaudeError extends Data.TaggedError("ClaudeError")<{
  readonly message: string;
  readonly stderr?: string;
  readonly cause?: unknown;
}> {}

export type ClaudeSpawnArgs = {
  readonly cwd: string;
  readonly sessionId: string;
  readonly resume: boolean;
  readonly prompt: string;
};

const SYSTEM_PROMPT = `
You are building a small, mobile-first React + TypeScript web app for a family.
The host server will bundle and serve it; you only write the source. Output
exactly two files in the current directory:

1. index.tsx — a React 19 app written with idiomatic JSX and hooks. Import
   hooks from "react" (e.g. import { useState, useEffect } from "react").
   Mount the root component yourself using createRoot from "react-dom/client"
   into <div id="root">. Inline any CSS by injecting a <style> tag once on
   mount, or keep styles minimal — use system fonts.
2. manifest.json — {"name":"<short friendly name>","emoji":"<one emoji>",
   "description":"<one sentence>"}.

Hard rules:
- Do not write index.html — the server provides it.
- Do not write package.json, tsconfig.json, bun.lock, or any config file.
- Do not import from npm packages other than react / react-dom. No CDNs, no
  fetch() to external hosts. The app must work fully offline.
- All app state lives in component state and/or localStorage; there is no backend.
- Mobile-first, kid-friendly: large tappable targets (≥44px), generous spacing,
  warm but not childish colors. Use system fonts. Embed any icons as inline SVG.
- Confirm to the user briefly when done.
`.trim();

const decodeEvent = S.decodeUnknown(ClaudeStreamEvent);

export class ClaudeService extends Context.Tag("ClaudeService")<
  ClaudeService,
  {
    /**
     * Spawn `claude` with stream-json output. The returned stream emits one
     * `ClaudeStreamEvent` per JSONL line. Subprocess lifetime is owned by the
     * caller's Scope — when the scope closes, the process is terminated.
     *
     * The stream completes when the subprocess exits with code 0; non-zero
     * exit fails the stream with `ClaudeError` carrying captured stderr.
     */
    readonly spawn: (
      args: ClaudeSpawnArgs,
    ) => Effect.Effect<
      Stream.Stream<ClaudeStreamEvent, ClaudeError>,
      ClaudeError,
      Scope.Scope
    >;
  }
>() {}

export const ClaudeLive = Layer.effect(
  ClaudeService,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;

    return ClaudeService.of({
      spawn: ({ cwd, sessionId, resume, prompt }) =>
        Effect.gen(function* () {
          const args = [
            "--print",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--permission-mode",
            "bypassPermissions",
            "--verbose",
          ];
          if (resume) {
            args.push("--resume", sessionId);
          } else {
            args.push("--session-id", sessionId);
            args.push("--append-system-prompt", SYSTEM_PROMPT);
          }
          args.push(prompt);

          const command = Command.make("claude", ...args).pipe(
            Command.workingDirectory(cwd),
          );

          // Start the process inside its own scope so .stdout / .stderr / .kill
          // are all wired to the same lifetime owned by the caller.
          const process = yield* executor.start(command).pipe(
            Effect.mapError(
              (cause) =>
                new ClaudeError({
                  message: "failed to start `claude` subprocess",
                  cause,
                }),
            ),
          );

          // Capture stderr into a ref so we can include it in error reports.
          const stderrRef = yield* Ref.make("");
          yield* Stream.runForEach(process.stderr, (chunk) =>
            Ref.update(stderrRef, (s) => s + new TextDecoder().decode(chunk)),
          ).pipe(
            Effect.catchAll(() => Effect.void),
            Effect.forkScoped,
          );

          const events: Stream.Stream<ClaudeStreamEvent, ClaudeError> = process.stdout.pipe(
            Stream.decodeText("utf8"),
            Stream.splitLines,
            Stream.filter((line) => line.trim().length > 0),
            Stream.mapEffect((line) =>
              Effect.try({
                try: () => JSON.parse(line) as unknown,
                catch: (cause) =>
                  new ClaudeError({
                    message: `non-JSON line on claude stdout: ${line.slice(0, 120)}`,
                    cause,
                  }),
              }).pipe(
                Effect.flatMap((u) =>
                  decodeEvent(u).pipe(
                    Effect.mapError(
                      (cause) =>
                        new ClaudeError({
                          message: "claude stdout event failed schema",
                          cause,
                        }),
                    ),
                  ),
                ),
              ),
            ),
            Stream.mapError((e) =>
              e instanceof ClaudeError ? e : new ClaudeError({ message: String(e) }),
            ),
            // After stdout closes, check exit code and fail if non-zero.
            Stream.concat(
              Stream.unwrap(
                Effect.gen(function* () {
                  const code = yield* process.exitCode.pipe(
                    Effect.mapError(
                      (cause) =>
                        new ClaudeError({
                          message: "could not read claude exit code",
                          cause,
                        }),
                    ),
                  );
                  if (code === 0) return Stream.empty as Stream.Stream<ClaudeStreamEvent, ClaudeError>;
                  const stderr = yield* Ref.get(stderrRef);
                  return Stream.fail(
                    new ClaudeError({
                      message: `claude exited with code ${code}`,
                      stderr: stderr.slice(-2000),
                    }),
                  ) as Stream.Stream<ClaudeStreamEvent, ClaudeError>;
                }),
              ),
            ),
          );

          return events;
        }),
    });
  }),
);
