import { Context, Data, Effect, Layer } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrapStructured } from "./SonnetJson";

/**
 * Reverse-engineer a printed worksheet, coloring page, maze, sticker
 * chart, etc. into a spec for an interactive web-app version. The kid
 * snaps a photo with the host's camera; we hand the image to claude
 * (Opus 4.7 by default, vision-capable) via `claude --print` with the
 * `Read` tool allowed and a JSON schema enforcing the output shape.
 *
 * Why the CLI instead of the Anthropic API: the `claude` CLI is already
 * authenticated through claude code login, so this works on a fresh
 * checkout without provisioning ANTHROPIC_API_KEY. Same model, same
 * vision capability — the trade-off is one extra Read-tool round trip
 * (≈half a second) for zero env setup.
 *
 * The image is staged in a unique temp directory; claude is launched
 * with that directory as its cwd and instructed to read the file there.
 * Both the subprocess and the temp dir are scoped via
 * `Effect.acquireUseRelease`, so they're cleaned up on every exit path.
 *
 * Override the model with MOCHI_VISION_MODEL=sonnet (or a full id) if
 * Opus's pricing or latency is too heavy for a 1MP photo.
 */

export class VisionError extends Data.TaggedError("VisionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type WorksheetScan = {
  readonly name: string;
  readonly emoji: string;
  readonly description: string;
  readonly spec: string;
};

export class VisionService extends Context.Tag("VisionService")<
  VisionService,
  {
    readonly scanWorksheet: (
      image: Uint8Array,
      mimeType: string,
    ) => Effect.Effect<WorksheetScan, VisionError>;
  }
>() {}

const DEFAULT_MODEL = "opus";

const SCAN_SCHEMA = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["name", "emoji", "description", "spec"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 60 },
    emoji: { type: "string", minLength: 1, maxLength: 8 },
    description: { type: "string", maxLength: 280 },
    spec: { type: "string", minLength: 1 },
  },
});

const VISION_PROMPT = `A kid photographed a printed worksheet, coloring page, maze, puzzle, sticker chart, or similar because they want an INTERACTIVE web-app version of it. The image is in your current directory — read it, then describe how to turn it into a kid-friendly digital app.

Translate any non-English text on the worksheet into English in the spec.

Output JSON exactly:
{
  "name": "<short app name, English Title Case, max 60 chars>",
  "emoji": "<one emoji>",
  "description": "<one sentence what it is, English, max 280 chars>",
  "spec": "<2 to 4 sentence spec for the build team, English. Describe what the app does, what the kid taps/drags, the look (colors, mood), and any features that mirror the original page. Detailed enough an engineer could build it without seeing the photo.>"
}

Style hints for the spec:
- Mirror the original's content (same animals, same numbers, same theme).
- Make it tappable, not draggable, when feasible (works on TV remotes).
- Lean kid-friendly: warm colors, big targets, gentle feedback, scoreboard if the worksheet has answers.
- Keep state in localStorage so progress survives reloads.

Examples:
- Addition worksheet 1-10 → quizzes the same problems with tappable answer buttons, smiley feedback, scoreboard.
- Shark coloring page → tap regions to fill with chosen colors; matches the shark's outline from the page.
- Maze → drag a finger through; wall layout matches the photo.
- Daily-tasks sticker chart → digital chart with the same row labels; tap a cell to add a sticker; resets weekly.`;

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

function readField(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === "string" ? v.trim() : "";
}

export const VisionLive = Layer.succeed(
  VisionService,
  VisionService.of({
    scanWorksheet: (image, mimeType) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const dir = mkdtempSync(join(tmpdir(), "mochi-scan-"));
          const filename = `worksheet.${extFromMime(mimeType)}`;
          writeFileSync(join(dir, filename), image);
          return { dir, filename };
        }),
        ({ dir, filename }) =>
          Effect.gen(function* () {
            const model =
              process.env["MOCHI_VISION_MODEL"] ?? DEFAULT_MODEL;
            const t0 = Date.now();

            const stdout = yield* Effect.acquireUseRelease(
              Effect.sync(() =>
                Bun.spawn(
                  [
                    "claude",
                    "--print",
                    "--model",
                    model,
                    "--effort",
                    "low",
                    "--output-format",
                    "json",
                    "--json-schema",
                    SCAN_SCHEMA,
                    "--permission-mode",
                    "bypassPermissions",
                    // Just Read — claude reads the image file we staged
                    // in cwd. `--strict-mcp-config` (boolean) terminates
                    // the variadic `--tools` so the prompt isn't slurped.
                    "--tools",
                    "Read",
                    "--strict-mcp-config",
                    "--mcp-config",
                    '{"mcpServers":{}}',
                    "--disable-slash-commands",
                    "--setting-sources",
                    "",
                    "--exclude-dynamic-system-prompt-sections",
                    `${VISION_PROMPT}\n\n(The image to read is ./${filename} in your current directory.)`,
                  ],
                  { cwd: dir, stdout: "pipe", stderr: "pipe" },
                ),
              ),
              (proc) =>
                Effect.tryPromise({
                  try: async () => {
                    const out = await new Response(proc.stdout).text();
                    const code = await proc.exited;
                    if (code !== 0) {
                      const err = await new Response(proc.stderr).text();
                      throw new Error(
                        `claude exited ${code}: ${err.slice(0, 500)}`,
                      );
                    }
                    return out;
                  },
                  catch: (cause) =>
                    new VisionError({
                      message:
                        cause instanceof Error
                          ? cause.message
                          : String(cause),
                      cause,
                    }),
                }),
              (proc) =>
                Effect.sync(() => {
                  try {
                    proc.kill();
                  } catch {
                    /* already exited */
                  }
                }),
            );

            const parsedTop = yield* Effect.try({
              try: () => JSON.parse(stdout) as unknown,
              catch: (cause) =>
                new VisionError({
                  message: "claude stdout not JSON",
                  cause,
                }),
            });
            const structured = unwrapStructured(parsedTop);
            if (!structured) {
              return yield* Effect.fail(
                new VisionError({
                  message: "no structured_output in claude response",
                }),
              );
            }

            const spec = readField(structured, "spec");
            if (!spec) {
              return yield* Effect.fail(
                new VisionError({ message: "vision returned empty spec" }),
              );
            }

            const name = readField(structured, "name").slice(0, 60);
            const emoji = readField(structured, "emoji").slice(0, 8);
            const description = readField(structured, "description").slice(
              0,
              280,
            );

            yield* Effect.log(
              `[vision] ${image.byteLength}B (${mimeType}) → "${name}" in ${Date.now() - t0}ms · ${model}`,
            );
            return {
              name: name || "Worksheet",
              emoji: emoji || "📋",
              description,
              spec,
            };
          }),
        ({ dir }) =>
          Effect.sync(() => {
            try {
              rmSync(dir, { recursive: true, force: true });
            } catch {
              /* best-effort */
            }
          }),
      ),
  }),
);
