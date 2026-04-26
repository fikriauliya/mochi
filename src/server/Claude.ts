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
The host bundles and serves it; you only write the source. Output exactly:

1. index.tsx — React 19. Mount with createRoot from "react-dom/client"
   into <div id="root">.
2. manifest.json — {"name":"<short>","emoji":"<one>","description":"<one sentence>"}.

The host pre-seeds these helpers — use them, don't reinvent:

- Root: <div className="app-shell">. Full-height column + safe-area
  padding (handles TV overscan + phone notches).
- Buttons: className="app-btn …" — 56px+ height with a visible focus
  ring (D-pad / TV remote friendly). Add color via bg-* / text-*.
  Use real <button>/<a>; never <div onClick>.
- Fluid type: app-h1 (page titles), app-h2 (sections), app-display
  (big numbers), app-body (text), app-tiny (small print).
- Sound: import { playTone, useMute } from "./shared".
    playTone(freqHz, durationMs?) — short kid-friendly tone, mute-aware.
    useMute() → [muted, toggle] persisted to localStorage. Render a
    🔊/🔇 <button className="app-btn"> wired to toggle.
- Voice (USE when speaking or listening is part of the experience —
  flashcards, story read-aloud, pronunciation drills, voice journals,
  "say the answer" quizzes; skip for purely visual apps). The host
  proxies ElevenLabs (high-quality, multilingual) at same-origin URLs.
  REQUIRED: use the host endpoints; do NOT use window.speechSynthesis,
  SpeechSynthesisUtterance, webkitSpeechRecognition, or SpeechRecognition
  — those are robotic / unreliable / blocked in WebViews.
    Speak text:
      const r = await fetch("/api/voice/tts", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({text})
      });
      const audio = new Audio(URL.createObjectURL(await r.blob()));
      audio.play();
    Transcribe a recording (lang = "en-US" or "id-ID"):
      const rec = new MediaRecorder(stream);  // stream from getUserMedia
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunks, {type: rec.mimeType});
        const r = await fetch("/api/voice/transcribe?lang=en-US", {
          method: "POST",
          headers: {"content-type": rec.mimeType},
          body: blob,
        });
        const {text} = await r.json();
      };
  Honour useMute() — when muted, don't play TTS audio. Don't auto-play
  on first paint (browsers block it); trigger from a tap/click. Keep
  TTS strings short — generation cost scales with characters.

Hard rules:
- Don't write index.html, styles.css, shared.tsx, or any config — host owns them.
- Imports allowed: "react", "react-dom/client", "./shared". No other npm.
  No CDNs, no <link> to external hosts, no fetch() to external hosts.
- All state in component state and/or localStorage. No backend.
- All visible UI text in English regardless of prompt language. Translate
  the *intent* of non-English prompts — don't echo their words verbatim.
- Tailwind v4 utility classes for everything else. No <style> tags. No
  external fonts. Inline SVG for icons.
- autoFocus the primary action on mount. Tab order matches visual order
  (no positive tabindex).
- Pair hover: with focus-visible: — TV has no mouse.
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
          // Effort controls extended-thinking depth. Sonnet with the
          // default level will spend many minutes generating reasoning
          // tokens before issuing tool calls — too much for a short app
          // build. "low" still produces solid output; bump to medium/high
          // via MOCHI_CLAUDE_EFFORT if you need the agent to think harder.
          const effort = process.env["MOCHI_CLAUDE_EFFORT"] ?? "low";
          const args = [
            "--print",
            "--model",
            model,
            "--effort",
            effort,
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--permission-mode",
            "bypassPermissions",
            "--verbose",
            // Token-efficiency: the agent only needs to read existing files
            // and write index.tsx + manifest.json. `--tools` restricts the
            // built-in set, but it does NOT prevent MCP-served tools or
            // plugin-injected tools from showing up — those slip in via the
            // user's settings.json (Figma/Gmail/Calendar/Drive/Playwright/
            // gopls/rust-analyzer plugins, etc.). The combined flags below
            // strip the agent's tool list down to just Read/Write/Edit:
            //   --tools                 — narrow the built-ins
            //   --strict-mcp-config +   — ignore every MCP source other
            //   --mcp-config '{}'         than this empty one
            //   --disable-slash-commands — skip skills (no /skill resolution)
            //   --setting-sources ""    — don't load user/project/local
            //                             plugins or agent definitions
            "--tools",
            "Write,Edit,Read",
            "--strict-mcp-config",
            "--mcp-config",
            '{"mcpServers":{}}',
            "--disable-slash-commands",
            "--setting-sources",
            "",
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
