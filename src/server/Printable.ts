import { Context, Data, Effect, Layer } from "effect";

/**
 * Generates a single-page printable infographic via OpenAI's gpt-image-2.
 *
 * gpt-image-2 (released April 2026) is OpenAI's reasoning-enabled image
 * model. It plans the image structure before drawing — strong fit for
 * infographics, charts, posters, and other text-heavy layouts that DALL-E
 * struggled with.
 *
 *   POST https://api.openai.com/v1/images/generations
 *   { model: "gpt-image-2", prompt, size, quality, output_format, n }
 *   → { data: [{ b64_json: "<base64 PNG>" }], usage: {...} }
 *
 * We always use:
 *   - `quality: "low"` — fast (≈10s) and cheap; the user opts in to printables
 *      knowing it's a draft-quality artifact.
 *   - `size: "1024x1536"` — portrait, the closest of gpt-image-2's three
 *      supported sizes to A4 (1:1.414). Letter (1:1.294) is also close.
 *   - `output_format: "png"` — lossless, prints cleanly.
 *
 * Authentication is `Authorization: Bearer $OPENAI_API_KEY`. Bun auto-loads
 * `.env`, so the key just needs to live in the repo's .env file.
 */

export class PrintableError extends Data.TaggedError("PrintableError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class PrintableService extends Context.Tag("PrintableService")<
  PrintableService,
  {
    /**
     * Generate a printable PNG. Returns the raw image bytes; the caller
     * is responsible for writing it to disk.
     */
    readonly generatePng: (
      prompt: string,
    ) => Effect.Effect<Uint8Array, PrintableError>;
  }
>() {}

const OPENAI_URL = "https://api.openai.com/v1/images/generations";

/**
 * Wraps the user's prompt with infographic-specific framing. We bias the
 * model toward the layout we want (single page, portrait, kid-readable,
 * print-friendly) so the user can describe the *subject* casually.
 */
function wrapPrompt(userPrompt: string): string {
  return [
    "Create a single-page printable infographic for a family member to print at home.",
    "Format: portrait orientation, sized for A4 paper, with a clear title at the top",
    "and well-organized sections below. Bold readable typography, generous spacing,",
    "tasteful flat illustrations, kid-friendly tone. White or off-white background",
    "with high-contrast ink to print well on a home printer (avoid full-bleed dark",
    "backgrounds that waste ink). All text must be in English regardless of the",
    "language of the request below.",
    "",
    `Subject: ${userPrompt}`,
  ].join(" ");
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const PrintableLive = Layer.succeed(
  PrintableService,
  PrintableService.of({
    generatePng: (prompt) =>
      Effect.gen(function* () {
        const apiKey = process.env["OPENAI_API_KEY"];
        if (!apiKey) {
          return yield* Effect.fail(
            new PrintableError({
              message:
                "OPENAI_API_KEY is not set. Add it to .env to enable printables.",
            }),
          );
        }

        const body = {
          model: "gpt-image-2",
          prompt: wrapPrompt(prompt),
          size: "1024x1536",
          quality: "low",
          output_format: "png",
          n: 1,
        };

        const res = yield* Effect.tryPromise({
          try: () =>
            fetch(OPENAI_URL, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
            }),
          catch: (cause) =>
            new PrintableError({
              message: "network error calling OpenAI",
              cause,
            }),
        });

        if (!res.ok) {
          const text = yield* Effect.tryPromise({
            try: () => res.text(),
            catch: () => null,
          }).pipe(Effect.catchAll(() => Effect.succeed("")));
          return yield* Effect.fail(
            new PrintableError({
              message: `OpenAI ${res.status}: ${text.slice(0, 500)}`,
            }),
          );
        }

        const json = yield* Effect.tryPromise({
          try: () =>
            res.json() as Promise<{
              data?: Array<{ b64_json?: string }>;
            }>,
          catch: (cause) =>
            new PrintableError({
              message: "OpenAI response was not JSON",
              cause,
            }),
        });

        const b64 = json.data?.[0]?.b64_json;
        if (!b64) {
          return yield* Effect.fail(
            new PrintableError({
              message: "OpenAI response had no b64_json image",
            }),
          );
        }

        return decodeBase64(b64);
      }),
  }),
);
