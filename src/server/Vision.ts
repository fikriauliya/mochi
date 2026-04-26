import { Context, Data, Effect, Layer } from "effect";

/**
 * Reverse-engineer a printed worksheet, coloring page, maze, sticker
 * chart, etc. into a spec for an interactive web-app version. The kid
 * snaps a photo with the host's camera; we hand the image to OpenAI's
 * gpt-4o-mini (vision-capable, cheap) and ask for a small JSON object
 * the build pipeline can consume verbatim.
 *
 *   POST https://api.openai.com/v1/chat/completions
 *   { model: "gpt-4o-mini", response_format: { type: "json_object" },
 *     messages: [{ role: "user", content: [{ type: "text", … },
 *                                          { type: "image_url", … }] }] }
 *
 * The returned `spec` is fed into the existing /api/apps create flow —
 * the agent treats it like any other prompt, no special casing needed.
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

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const VISION_PROMPT = `You're looking at a printed worksheet, coloring page, maze, puzzle, sticker chart, or similar that a kid photographed because they want an INTERACTIVE web-app version of it.

Identify what's on the page (math problems, animal coloring, maze, word search, sticker chart, dot-to-dot, music sheet, recipe, etc), then write a spec for a kid-friendly INTERACTIVE digital version. Translate any non-English text on the worksheet into English in the spec.

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

function toDataUrl(image: Uint8Array, mimeType: string): string {
  // bigger images blow the prompt size budget; gpt-4o-mini happily reads
  // ~1MP photos, so a phone capture downscaled to ~1024px is plenty.
  // We trust the client to send a reasonable jpeg already.
  const b64 = Buffer.from(image).toString("base64");
  return `data:${mimeType};base64,${b64}`;
}

export const VisionLive = Layer.succeed(
  VisionService,
  VisionService.of({
    scanWorksheet: (image, mimeType) =>
      Effect.gen(function* () {
        const apiKey = process.env["OPENAI_API_KEY"];
        if (!apiKey) {
          return yield* Effect.fail(
            new VisionError({ message: "OPENAI_API_KEY is not set" }),
          );
        }

        const t0 = Date.now();
        const res = yield* Effect.tryPromise({
          try: () =>
            fetch(OPENAI_CHAT_URL, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                response_format: { type: "json_object" },
                max_tokens: 600,
                temperature: 0.4,
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: VISION_PROMPT },
                      {
                        type: "image_url",
                        image_url: { url: toDataUrl(image, mimeType) },
                      },
                    ],
                  },
                ],
              }),
            }),
          catch: (cause) =>
            new VisionError({
              message: "network error calling OpenAI vision",
              cause,
            }),
        });

        if (!res.ok) {
          const body = yield* Effect.promise(() =>
            res.text().catch(() => ""),
          );
          return yield* Effect.fail(
            new VisionError({
              message: `vision ${res.status}: ${body.slice(0, 500)}`,
            }),
          );
        }

        const json = yield* Effect.tryPromise({
          try: () =>
            res.json() as Promise<{
              choices?: Array<{ message?: { content?: string } }>;
            }>,
          catch: (cause) =>
            new VisionError({ message: "vision response not JSON", cause }),
        });
        const content = json.choices?.[0]?.message?.content ?? "";
        const parsed = yield* Effect.try({
          try: () =>
            JSON.parse(content) as {
              name?: unknown;
              emoji?: unknown;
              description?: unknown;
              spec?: unknown;
            },
          catch: (cause) =>
            new VisionError({
              message: "vision JSON inner not parseable",
              cause,
            }),
        });

        const name =
          typeof parsed.name === "string" ? parsed.name.trim().slice(0, 60) : "";
        const emoji =
          typeof parsed.emoji === "string"
            ? parsed.emoji.trim().slice(0, 8)
            : "📋";
        const description =
          typeof parsed.description === "string"
            ? parsed.description.trim().slice(0, 280)
            : "";
        const spec =
          typeof parsed.spec === "string" ? parsed.spec.trim() : "";
        if (!spec) {
          return yield* Effect.fail(
            new VisionError({ message: "vision returned empty spec" }),
          );
        }
        yield* Effect.log(
          `[vision] ${image.byteLength}B (${mimeType}) → "${name}" in ${Date.now() - t0}ms`,
        );
        return {
          name: name || "Worksheet",
          emoji: emoji || "📋",
          description,
          spec,
        };
      }),
  }),
);
