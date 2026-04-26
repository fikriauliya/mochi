import { Context, Data, Effect, Layer } from "effect";
import type { AppKind } from "./Schema";

/**
 * After every successful build, ask claude-sonnet to bucket the family's
 * apps + printables into a small set of categories ("Kid Games", "Daily
 * Routines", "Calculators", etc) and order them within each bucket. The
 * result is persisted as `category` + `position` per row in SQLite, and
 * the home grid renders one section per category.
 *
 * The call is fire-and-forget from `Jobs.ts` so a slow organize never
 * blocks the build's `done` event. Failures are swallowed in this
 * service; on any error the input is returned as a single "" group so
 * the caller can still persist a sane state.
 *
 * Cost is small (~50-100 input tokens × #apps, ~600 output) so running
 * on every build is fine.
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

export type OrganizeGroup = {
  readonly name: string;
  readonly appIds: ReadonlyArray<string>;
};

export class OrganizeService extends Context.Tag("OrganizeService")<
  OrganizeService,
  {
    /**
     * Returns the input apps grouped into categories, with each group's
     * appIds in display order. Every input id appears exactly once.
     * Never fails: on any error the input is returned as one empty-named
     * group ("") in original order.
     */
    readonly organize: (
      apps: OrganizeInput,
    ) => Effect.Effect<ReadonlyArray<OrganizeGroup>, never>;
  }
>() {}

const RESPONSE_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    groups: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          appIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
        required: ["name", "appIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
});

const ORGANIZE_SYSTEM_PROMPT = `You organize a family app launcher's home screen.

Given a list of small web apps and printable infographics the family has built,
return them grouped into 2-5 short, family-friendly category names ("Kid Games",
"Daily Routines", "Calculators", "Health & Body", "Recipes", etc).

Rules:
- Use Title Case category names; ≤24 chars each.
- Most-likely-to-tap categories first.
- Within each group, order by likely usefulness (bigger / broader first).
- Place each printable next to the apps it most relates to.
- Every id appears in exactly one group.

Respond ONLY with JSON matching the schema.`;

function buildPrompt(apps: OrganizeInput): string {
  const list = apps
    .map(
      (a) =>
        `- ${a.id}: ${a.emoji} ${a.name} (${a.kind}) — ${a.description.slice(0, 120)}`,
    )
    .join("\n");
  return `${ORGANIZE_SYSTEM_PROMPT}\n\nApps:\n${list}`;
}

type RawGroup = { name?: unknown; appIds?: unknown };

function extractGroups(parsed: unknown): ReadonlyArray<OrganizeGroup> | null {
  if (!parsed || typeof parsed !== "object") return null;
  // claude --json-schema lands the validated payload at `.structured_output`;
  // older versions wrapped it under `.result`. Be defensive about both, plus
  // the bare top-level shape.
  const p = parsed as Record<string, unknown>;
  const candidates = [p["structured_output"], p["result"], parsed];
  for (const c of candidates) {
    if (c && typeof c === "object" && Array.isArray((c as { groups?: unknown }).groups)) {
      const raw = (c as { groups: ReadonlyArray<RawGroup> }).groups;
      const groups: OrganizeGroup[] = [];
      for (const g of raw) {
        if (typeof g.name !== "string") continue;
        if (!Array.isArray(g.appIds)) continue;
        const ids = g.appIds.filter((x): x is string => typeof x === "string");
        if (ids.length === 0) continue;
        groups.push({ name: g.name.slice(0, 40), appIds: ids });
      }
      if (groups.length > 0) return groups;
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
      // `--tools` is variadic — must be followed by a non-variadic flag to
      // stop it slurping subsequent args. We put the empty value here and
      // let `--strict-mcp-config` (a boolean flag) terminate the list.
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--disable-slash-commands",
      "--setting-sources",
      "",
      "--exclude-dynamic-system-prompt-sections",
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

const fallback = (apps: OrganizeInput): ReadonlyArray<OrganizeGroup> => [
  { name: "", appIds: apps.map((a) => a.id) },
];

export const OrganizeLive = Layer.succeed(
  OrganizeService,
  OrganizeService.of({
    organize: (apps) =>
      Effect.gen(function* () {
        if (apps.length < 2) return fallback(apps);

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
        const raw = extractGroups(parsed);
        if (!raw) {
          return yield* Effect.fail(
            new OrganizeError({
              message: "organize: response missing 'groups' array",
            }),
          );
        }

        // Filter to known ids, dedupe across groups, then append any
        // dropped apps to a final "Other" group so every id is represented.
        const knownIds = new Set(apps.map((a) => a.id));
        const seen = new Set<string>();
        const finalGroups: OrganizeGroup[] = [];
        for (const g of raw) {
          const ids: string[] = [];
          for (const id of g.appIds) {
            if (knownIds.has(id) && !seen.has(id)) {
              ids.push(id);
              seen.add(id);
            }
          }
          if (ids.length > 0) finalGroups.push({ name: g.name, appIds: ids });
        }
        const missing = apps.filter((a) => !seen.has(a.id)).map((a) => a.id);
        if (missing.length > 0) {
          finalGroups.push({ name: "Other", appIds: missing });
        }

        yield* Effect.log(
          `[organize] ${apps.length} apps → ${finalGroups.length} groups in ${Date.now() - t0}ms`,
        );
        return finalGroups;
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(`[organize] failed: ${cause.message}`);
            return fallback(apps);
          }),
        ),
      ),
  }),
);
