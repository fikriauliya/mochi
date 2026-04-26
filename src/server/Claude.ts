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
The host server bundles and serves it; you only write the source. Output
exactly two files in the current directory:

1. index.tsx — a React 19 app with idiomatic JSX and hooks. Import hooks
   from "react". Mount with createRoot from "react-dom/client" into
   <div id="root">.
2. manifest.json — {"name":"<short friendly name>","emoji":"<one emoji>",
   "description":"<one sentence>"}.

Styling: use Tailwind v4 utility classes directly in className. The host
auto-wires a Tailwind entrypoint and the bundler scans your index.tsx for
class usage at build time, so you do not need to import any CSS file or
write any <style> tags. Don't write a styles.css — the server owns it.

Hard rules:
- Do not write index.html, styles.css, package.json, or any config file.
- Do not import from npm packages other than react / react-dom. No CDNs,
  no <link> to external hosts, no fetch() to external hosts. The app must
  work fully offline.
- All app state lives in component state and/or localStorage; no backend.
- All visible UI text (titles, labels, buttons, placeholders, helper
  text, manifest name + description, error messages) must be in English,
  regardless of the user's prompt language. Translate the *intent* of
  non-English prompts into an English-language app — don't echo their
  words verbatim into the UI.

UI must be tablet, TV, and mobile friendly (Mochi runs in an Android
WebView on a TV with a D-pad remote — no mouse, no touch). Encode this
through Tailwind utilities:
- Interactive things are real focusable elements (<button>, <a>), never
  <div onClick>. Targets ≥56px tall — use min-h-14 (56px) or larger.
- A visible focus ring on every focusable element. The host hasn't
  preconfigured a default; add it yourself, e.g.:
    focus-visible:outline-none focus-visible:ring-4
    focus-visible:ring-orange-500 focus-visible:ring-offset-2
- No hover-only behaviour — everything that fires on :hover must also
  fire on :focus / :focus-visible. Pair hover: with focus-visible:.
- Body text uses fluid sizing — Tailwind 4 supports arbitrary values:
    text-[clamp(1.125rem,2.5vw,1.75rem)]
  Headings: text-[clamp(1.75rem,6vw,3.5rem)].
- Safe area on the root element so TV overscan & phone notches don't
  clip content:
    pt-[max(20px,env(safe-area-inset-top))]
    pb-[max(20px,env(safe-area-inset-bottom))]
    pl-[max(20px,env(safe-area-inset-left))]
    pr-[max(20px,env(safe-area-inset-right))]
- Tab order matches visual order — don't use positive tabindex values.
- Auto-focus the primary action when a screen mounts (autoFocus on the
  most important <button> in the initial render).
- Warm colors, generous spacing, system fonts (default Tailwind sans),
  inline SVG icons.

Sound effects (kids love them, and they make a TV feel alive):
- Synthesize short tones with the Web Audio API — no audio files. A
  single AudioContext + Oscillator + Gain envelope handles taps,
  success chimes, and error blips.
- Lazily create the AudioContext on the first user interaction (autoplay
  policies block it before then). Reuse one context for the whole app.
- Short envelopes (≤200ms total) and low gain (peak ≤ 0.2). TVs amplify
  everything — quiet is the default.
- Provide a small mute toggle (🔊 / 🔇 <button>) and persist the choice
  in localStorage so a parent can silence the app once.
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
          // Default to sonnet — ~40% cheaper than opus and noticeably faster
          // at TTFT on these short, write-heavy prompts. Override with
          // MOCHI_CLAUDE_MODEL=opus (or a full model id) in .env if you want
          // higher-quality output for a specific session.
          const model = process.env["MOCHI_CLAUDE_MODEL"] ?? "sonnet";
          const args = [
            "--print",
            "--model",
            model,
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--permission-mode",
            "bypassPermissions",
            "--verbose",
            // Token-efficiency: the agent only needs to read existing files
            // and write index.tsx + manifest.json. Stripping every other tool
            // saves a lot of system-prompt overhead per call.
            "--tools",
            "Write,Edit,Read",
            // No skills, no project/local settings — we don't use them, and
            // they'd add tokens + side-effects we don't want.
            "--disable-slash-commands",
            "--setting-sources",
            "user",
            // Move per-machine sections (cwd/env/git status) out of the cached
            // system prompt so the static prefix is reused across builds.
            "--exclude-dynamic-system-prompt-sections",
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
          const child = yield* executor.start(command).pipe(
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
          yield* Stream.runForEach(child.stderr, (chunk) =>
            Ref.update(stderrRef, (s) => s + new TextDecoder().decode(chunk)),
          ).pipe(
            Effect.catchAll(() => Effect.void),
            Effect.forkScoped,
          );

          const events: Stream.Stream<ClaudeStreamEvent, ClaudeError> = child.stdout.pipe(
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
                  const code = yield* child.exitCode.pipe(
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
