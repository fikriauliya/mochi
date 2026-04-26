import Anthropic from "@anthropic-ai/sdk";
import { Context, Data, Effect, Layer } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModelId, useApi } from "./ClaudeBackend";
import { unwrapStructured } from "./SonnetJson";

/**
 * Reverse-engineer a printed worksheet / coloring page / maze into a
 * spec for an interactive web-app version. Two backends behind one
 * Effect entry point — `MOCHI_CLAUDE_BACKEND` picks at runtime.
 *
 *   cli (default): stage the photo in a unique temp dir, spawn
 *     `claude --print --model opus --tools Read --json-schema …` with
 *     that dir as cwd. Claude reads the file via the Read tool and
 *     returns structured output. No API key — uses claude code login.
 *     Trade-off: ~+0.5s for the Read round trip and a temp-file dance.
 *
 *   api: post directly to `/v1/messages` with an `image` content block
 *     and a forced `tool_use` whose `input_schema` IS our schema. No
 *     temp file, no Read tool round trip. Requires ANTHROPIC_API_KEY.
 *
 * Override the model with MOCHI_VISION_MODEL=sonnet if Opus's latency
 * or pricing is too heavy for a 1MP photo.
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

const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

type WorksheetFields = {
  name: string;
  emoji: string;
  description: string;
  spec: string;
};

function buildScan(
  fields: WorksheetFields,
  image: Uint8Array,
  mimeType: string,
  model: string,
  t0: number,
): Effect.Effect<WorksheetScan, VisionError> {
  return Effect.gen(function* () {
    if (!fields.spec) {
      return yield* Effect.fail(
        new VisionError({ message: "vision returned empty spec" }),
      );
    }
    yield* Effect.log(
      `[vision] ${image.byteLength}B (${mimeType}) → "${fields.name}" in ${Date.now() - t0}ms · ${model}`,
    );
    return {
      name: fields.name.slice(0, 60) || "Worksheet",
      emoji: fields.emoji.slice(0, 8) || "📋",
      description: fields.description.slice(0, 280),
      spec: fields.spec,
    };
  });
}

function fieldsFromRecord(structured: Record<string, unknown>): WorksheetFields {
  return {
    name: readField(structured, "name"),
    emoji: readField(structured, "emoji"),
    description: readField(structured, "description"),
    spec: readField(structured, "spec"),
  };
}

function scanViaCli(
  image: Uint8Array,
  mimeType: string,
): Effect.Effect<WorksheetScan, VisionError> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const dir = mkdtempSync(join(tmpdir(), "mochi-scan-"));
      const filename = `worksheet.${extFromMime(mimeType)}`;
      writeFileSync(join(dir, filename), image);
      return { dir, filename };
    }),
    ({ dir, filename }) =>
      Effect.gen(function* () {
        const model = process.env["MOCHI_VISION_MODEL"] ?? DEFAULT_MODEL;
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
                    cause instanceof Error ? cause.message : String(cause),
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
            new VisionError({ message: "claude stdout not JSON", cause }),
        });
        const structured = unwrapStructured(parsedTop);
        if (!structured) {
          return yield* Effect.fail(
            new VisionError({
              message: "no structured_output in claude response",
            }),
          );
        }
        return yield* buildScan(
          fieldsFromRecord(structured),
          image,
          mimeType,
          model,
          t0,
        );
      }),
    ({ dir }) =>
      Effect.sync(() => {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }),
  );
}

function scanViaApi(
  image: Uint8Array,
  mimeType: string,
): Effect.Effect<WorksheetScan, VisionError> {
  return Effect.gen(function* () {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      return yield* Effect.fail(
        new VisionError({
          message:
            "MOCHI_CLAUDE_BACKEND=api requires ANTHROPIC_API_KEY in .env",
        }),
      );
    }
    const mediaType = (
      ALLOWED_MEDIA_TYPES.has(mimeType) ? mimeType : "image/jpeg"
    ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    const model = resolveModelId(
      process.env["MOCHI_VISION_MODEL"] ?? DEFAULT_MODEL,
    );
    const t0 = Date.now();

    const inputSchema = JSON.parse(SCAN_SCHEMA) as Record<string, unknown>;
    const fields = yield* Effect.tryPromise({
      try: async () => {
        const client = new Anthropic({ apiKey });
        const res = await client.messages.create({
          model,
          max_tokens: 1024,
          tools: [
            {
              name: "scan_result",
              description:
                "Send the structured scan result for this worksheet.",
              input_schema: inputSchema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: "tool", name: "scan_result" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: Buffer.from(image).toString("base64"),
                  },
                },
                { type: "text", text: VISION_PROMPT },
              ],
            },
          ],
        });
        const block = res.content.find((b) => b.type === "tool_use");
        if (!block || block.type !== "tool_use") {
          throw new Error("API returned no tool_use block");
        }
        return fieldsFromRecord(block.input as Record<string, unknown>);
      },
      catch: (cause) =>
        new VisionError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    return yield* buildScan(fields, image, mimeType, model, t0);
  });
}

export const VisionLive = Layer.succeed(
  VisionService,
  VisionService.of({
    scanWorksheet: (image, mimeType) =>
      useApi() ? scanViaApi(image, mimeType) : scanViaCli(image, mimeType),
  }),
);
