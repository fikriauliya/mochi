import { Context, Data, Effect, Layer } from "effect";
import { callJsonSchema, unwrapStructured } from "./SonnetJson";
import type { BuildEvent, SpeechLang } from "./Schema";

/**
 * Mochi's "voice acting" during a build. Watches the streamed agent
 * trace and asks sonnet for one short kid-friendly first-person line
 * about what Mochi is up to right now ("now I'm picking happy colors!").
 *
 * Best-effort: failures bubble up as NarratorError and the caller
 * silently skips that turn. The frontend plays the line through the
 * existing TTS pipeline (`/api/voice/tts`).
 */

export class NarratorError extends Data.TaggedError("NarratorError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class NarratorService extends Context.Tag("NarratorService")<
  NarratorService,
  {
    readonly narrate: (
      events: ReadonlyArray<BuildEvent>,
      lang: SpeechLang,
    ) => Effect.Effect<string, NarratorError>;
  }
>() {}

const NARRATION_SCHEMA = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 120 },
  },
});

function eventsToTrace(events: ReadonlyArray<BuildEvent>): string {
  const lines: string[] = [];
  for (const e of events) {
    if (e.type === "tool") {
      lines.push(`- used ${e.tool}${e.summary ? ` on ${e.summary}` : ""}`);
    } else if (e.type === "tool_result") {
      lines.push(`- ${e.tool || "tool"} ${e.ok ? "succeeded" : "failed"}`);
    } else if (e.type === "text") {
      lines.push(`- thought: ${e.text.slice(0, 200)}`);
    }
  }
  return lines.slice(-8).join("\n");
}

export const NarratorLive = Layer.succeed(
  NarratorService,
  NarratorService.of({
    narrate: (events, lang) =>
      Effect.gen(function* () {
        const trace = eventsToTrace(events);
        if (!trace) return "";
        const langName = lang === "id-ID" ? "Indonesian" : "English";

        const prompt = `You are Mochi, a friendly cooking-mascot building a small web app for a kid right now.

Below is what you (Mochi) just did inside Claude Code. Write ONE SHORT sentence (max ~12 words) in first person, present tense, telling the kid what you are up to. Warm, a touch playful, kid-friendly. NO emoji, NO quotes, NO hashtags. Output language: ${langName}.

Recent activity:
${trace}`;

        const parsed = yield* callJsonSchema({
          prompt,
          schema: NARRATION_SCHEMA,
          model: "sonnet",
          effort: "low",
        }).pipe(
          Effect.mapError(
            (cause) =>
              new NarratorError({ message: cause.message, cause }),
          ),
        );

        const out = unwrapStructured(parsed);
        const text =
          typeof out?.["text"] === "string"
            ? (out["text"] as string).trim()
            : "";
        return text;
      }),
  }),
);
