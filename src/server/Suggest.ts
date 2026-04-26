import { Context, Data, Effect, Layer } from "effect";
import type { AppKind } from "./Schema";
import { callJsonSchema, unwrapStructured } from "./SonnetJson";

/**
 * Asks claude-sonnet for 5 short prompt ideas the family hasn't built
 * yet. Sees the existing registry, biases for variety (one kid game,
 * one parent tool, one learning thing, one daily routine, one creative).
 *
 *   prompt → { suggestions: [<phrase>...] }
 *
 * Failure-tolerant: returns a static fallback list on any error so the
 * home view always has something to show. In-memory cache (keyed on the
 * app-id set) lives in HttpApi.ts so the call doesn't re-fire on every
 * page load.
 */

export class SuggestError extends Data.TaggedError("SuggestError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type SuggestInput = ReadonlyArray<{
  readonly name: string;
  readonly emoji: string;
  readonly description: string;
  readonly kind: AppKind;
}>;

export class SuggestService extends Context.Tag("SuggestService")<
  SuggestService,
  {
    readonly suggest: (
      apps: SuggestInput,
    ) => Effect.Effect<ReadonlyArray<string>, never>;
  }
>() {}

const DEFAULT_SUGGESTIONS: ReadonlyArray<string> = [
  "a flashcard quiz about animals",
  "a tap-the-color game",
  "a checklist for the morning",
  "a dinosaur sticker board",
  "a counting game with apples",
];

const RESPONSE_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: { type: "string" },
      minItems: 5,
      maxItems: 5,
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
});

const SUGGEST_SYSTEM_PROMPT = `You suggest short prompt ideas for a family app launcher.

The user will list the apps and printables they already have. Return
exactly 5 fresh ideas:
- ≤8 words each, lowercase, kid-safe.
- Sound like a casual prompt someone would speak ("a … for …").
- Spread across: kid game, parent/household tool, learning, daily routine, creative.
- No overlap with what they already have.

Respond ONLY with JSON matching the schema.`;

function buildPrompt(apps: SuggestInput): string {
  const list =
    apps.length === 0
      ? "(none yet — brand new launcher)"
      : apps
          .map(
            (a) =>
              `- ${a.emoji} ${a.name} (${a.kind}) — ${a.description.slice(0, 100)}`,
          )
          .join("\n");
  return `${SUGGEST_SYSTEM_PROMPT}\n\nApps so far:\n${list}`;
}

function extractSuggestions(parsed: unknown): ReadonlyArray<string> | null {
  const obj = unwrapStructured(parsed);
  if (!obj || !Array.isArray(obj["suggestions"])) return null;
  const list = (obj["suggestions"] as ReadonlyArray<unknown>).filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  return list.length > 0 ? list : null;
}

export const SuggestLive = Layer.succeed(
  SuggestService,
  SuggestService.of({
    suggest: (apps) =>
      Effect.gen(function* () {
        const t0 = Date.now();
        const parsed = yield* callJsonSchema({
          prompt: buildPrompt(apps),
          schema: RESPONSE_SCHEMA,
        }).pipe(
          Effect.mapError(
            (e) => new SuggestError({ message: e.message, cause: e.cause }),
          ),
          Effect.timeoutFail({
            duration: "60 seconds",
            onTimeout: () =>
              new SuggestError({ message: "claude suggest timed out" }),
          }),
        );
        const suggestions = extractSuggestions(parsed);
        if (!suggestions || suggestions.length === 0) {
          return yield* Effect.fail(
            new SuggestError({ message: "missing 'suggestions' array" }),
          );
        }
        yield* Effect.log(
          `[suggest] ${apps.length} known → ${suggestions.length} ideas in ${Date.now() - t0}ms`,
        );
        return suggestions.slice(0, 5);
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(`[suggest] failed: ${cause.message}`);
            return DEFAULT_SUGGESTIONS;
          }),
        ),
      ),
  }),
);
