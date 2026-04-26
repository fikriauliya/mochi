import { Context, Data, Effect, Layer } from "effect";
import type { AppKind } from "./Schema";
import { callJsonSchema, unwrapStructured } from "./SonnetJson";

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
  const obj = unwrapStructured(parsed);
  if (!obj || !Array.isArray(obj["groups"])) return null;
  const raw = obj["groups"] as ReadonlyArray<RawGroup>;
  const groups: OrganizeGroup[] = [];
  for (const g of raw) {
    if (typeof g.name !== "string") continue;
    if (!Array.isArray(g.appIds)) continue;
    const ids = g.appIds.filter((x): x is string => typeof x === "string");
    if (ids.length === 0) continue;
    groups.push({ name: g.name.slice(0, 40), appIds: ids });
  }
  return groups.length > 0 ? groups : null;
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
        const parsed = yield* callJsonSchema({
          prompt: buildPrompt(apps),
          schema: RESPONSE_SCHEMA,
        }).pipe(
          Effect.mapError(
            (e) => new OrganizeError({ message: e.message, cause: e.cause }),
          ),
          Effect.timeoutFail({
            duration: "60 seconds",
            onTimeout: () =>
              new OrganizeError({ message: "claude organize timed out" }),
          }),
        );
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
