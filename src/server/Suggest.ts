import { Context, Data, Effect, Layer } from "effect";
import type { AppKind } from "./Schema";

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
  if (!parsed || typeof parsed !== "object") return null;
  const candidates = [parsed, (parsed as { result?: unknown }).result];
  for (const c of candidates) {
    if (c && typeof c === "object" && "suggestions" in c) {
      const s = (c as { suggestions: unknown }).suggestions;
      if (Array.isArray(s))
        return s.filter((x): x is string => typeof x === "string" && x.length > 0);
    }
  }
  return null;
}

async function callClaude(prompt: string): Promise<string> {
  const proc = Bun.spawn(
    [
      "claude",
      "--print",
      "--model",
      "sonnet",
      "--effort",
      "low",
      "--output-format",
      "json",
      "--json-schema",
      RESPONSE_SCHEMA,
      "--permission-mode",
      "bypassPermissions",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--disable-slash-commands",
      "--setting-sources",
      "",
      "--exclude-dynamic-system-prompt-sections",
      "--tools",
      "",
      prompt,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`);
  }
  return stdout;
}

export const SuggestLive = Layer.succeed(
  SuggestService,
  SuggestService.of({
    suggest: (apps) =>
      Effect.gen(function* () {
        const t0 = Date.now();
        const stdout = yield* Effect.tryPromise({
          try: () => callClaude(buildPrompt(apps)),
          catch: (cause) =>
            new SuggestError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }).pipe(
          Effect.timeoutFail({
            duration: "60 seconds",
            onTimeout: () =>
              new SuggestError({ message: "claude suggest timed out" }),
          }),
        );

        const parsed = yield* Effect.try({
          try: () => JSON.parse(stdout) as unknown,
          catch: (cause) =>
            new SuggestError({ message: "non-JSON response", cause }),
        });
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
