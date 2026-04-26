import { Context, Data, Effect, Layer } from "effect";
import type { AppKind } from "./Schema";

/**
 * After a successful build, the home grid would otherwise drift into
 * recency-only order. OrganizeService asks claude-sonnet (low effort,
 * no tools, no MCP) to return a sensible display order — kid games near
 * each other, calculators near each other, printables next to their
 * related apps. The returned array is persisted as `position` per row.
 *
 * The call is fire-and-forget from `Jobs.ts` so a slow organize never
 * blocks the build's `done` event. Failures are logged and ignored —
 * the worst case is the grid stays in its current order.
 *
 * Cost is tiny (~50-100 input tokens × #apps, ~500 output tokens) so
 * running on every build is fine.
 */

export class OrganizeError extends Data.TaggedError("OrganizeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type OrganizeInput = ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly description: string;
  readonly kind: AppKind;
}>;

export class OrganizeService extends Context.Tag("OrganizeService")<
  OrganizeService,
  {
    /**
     * Returns the input apps' ids in a recommended display order. On any
     * error returns the input order unchanged (never throws to the caller).
     */
    readonly organize: (
      apps: OrganizeInput,
    ) => Effect.Effect<ReadonlyArray<string>, never>;
  }
>() {}

const RESPONSE_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    order: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["order"],
  additionalProperties: false,
});

const ORGANIZE_SYSTEM_PROMPT = `You organize a family app launcher's home screen.
Given a list of small web apps and printable infographics the family has built,
return the ids in a sensible display order:
- Most likely useful first.
- Group related apps together (all calculators, all kid games, all daily routines).
- Place each printable next to the apps it most relates to.
Respond ONLY with JSON matching the schema. Include every id exactly once.`;

function buildPrompt(apps: OrganizeInput): string {
  const list = apps
    .map(
      (a) =>
        `- ${a.id}: ${a.emoji} ${a.name} (${a.kind}) — ${a.description.slice(0, 120)}`,
    )
    .join("\n");
  return `${ORGANIZE_SYSTEM_PROMPT}\n\nApps:\n${list}`;
}

function extractOrder(parsed: unknown): ReadonlyArray<string> | null {
  if (!parsed || typeof parsed !== "object") return null;
  // claude --output-format=json wraps in { result: <json-schema-validated> }
  // when --json-schema is supplied. Be defensive about both shapes.
  const candidates = [parsed, (parsed as { result?: unknown }).result];
  for (const c of candidates) {
    if (c && typeof c === "object" && "order" in c) {
      const order = (c as { order: unknown }).order;
      if (Array.isArray(order)) return order.filter((x): x is string => typeof x === "string");
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

export const OrganizeLive = Layer.succeed(
  OrganizeService,
  OrganizeService.of({
    organize: (apps) =>
      Effect.gen(function* () {
        if (apps.length < 2) return apps.map((a) => a.id);

        const t0 = Date.now();
        const stdout = yield* Effect.tryPromise({
          try: () => callClaude(buildPrompt(apps)),
          catch: (cause) =>
            new OrganizeError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }).pipe(
          Effect.timeoutFail({
            duration: "60 seconds",
            onTimeout: () =>
              new OrganizeError({ message: "claude organize timed out" }),
          }),
        );

        const parsed = yield* Effect.try({
          try: () => JSON.parse(stdout) as unknown,
          catch: (cause) =>
            new OrganizeError({
              message: "organize: response was not JSON",
              cause,
            }),
        });
        const order = extractOrder(parsed);
        if (!order) {
          return yield* Effect.fail(
            new OrganizeError({
              message: "organize: response missing 'order' array",
            }),
          );
        }

        // Filter to known ids, dedupe, then append any apps the model
        // dropped — this guarantees every input id appears exactly once.
        const knownIds = new Set(apps.map((a) => a.id));
        const seen = new Set<string>();
        const result: string[] = [];
        for (const id of order) {
          if (knownIds.has(id) && !seen.has(id)) {
            result.push(id);
            seen.add(id);
          }
        }
        for (const a of apps) {
          if (!seen.has(a.id)) result.push(a.id);
        }
        yield* Effect.log(
          `[organize] ${apps.length} apps → ordered in ${Date.now() - t0}ms`,
        );
        return result;
      }).pipe(
        // Failures fall back to input order; never propagate to the caller.
        Effect.catchAll((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(`[organize] failed: ${cause.message}`);
            return apps.map((a) => a.id);
          }),
        ),
      ),
  }),
);
