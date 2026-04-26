/**
 * Per-million-token API pricing for Claude models, in USD.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 *
 * - `input` / `output` are the base rates per 1M tokens.
 * - `cacheWrite5m` is the 5-minute prompt-cache write rate (1.25× input).
 * - `cacheRead` is the prompt-cache hit rate (0.10× input).
 *
 * The 1-hour cache write tier (2× input) isn't tracked separately here —
 * stream-json doesn't distinguish 5m vs 1h writes in `usage`, so we approximate
 * everything as 5m. Off by ~30% on cache writes only, which is a tiny fraction
 * of total cost in practice.
 */
export type ModelRates = {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite5m: number;
  readonly cacheRead: number;
};

export const PRICING: Record<string, ModelRates> = {
  "claude-opus-4-7": { input: 5, output: 25, cacheWrite5m: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheWrite5m: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5": { input: 5, output: 25, cacheWrite5m: 6.25, cacheRead: 0.5 },
  "claude-opus-4-1": { input: 15, output: 75, cacheWrite5m: 18.75, cacheRead: 1.5 },
  "claude-opus-4": { input: 15, output: 75, cacheWrite5m: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite5m: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite5m: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4": { input: 3, output: 15, cacheWrite5m: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite5m: 1.25, cacheRead: 0.1 },
  "claude-haiku-3-5": { input: 0.8, output: 4, cacheWrite5m: 1, cacheRead: 0.08 },
  "claude-haiku-3": { input: 0.25, output: 1.25, cacheWrite5m: 0.3, cacheRead: 0.03 },
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type CostBreakdown = {
  readonly usd: number;
  readonly model: string;
  readonly rates: ModelRates;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
};

/**
 * Look up rates for a model id. Tolerates trailing date suffixes (e.g.
 * `claude-opus-4-7-20260101`) and falls back to family+version matching
 * for unknown variants.
 */
export function lookupRates(model: string): ModelRates | null {
  if (PRICING[model]) return PRICING[model] ?? null;
  // Strip a trailing -YYYYMMDD date stamp.
  const stripped = model.replace(/-\d{8}$/, "");
  if (PRICING[stripped]) return PRICING[stripped] ?? null;
  // Fall back to family + version match: extract `(opus|sonnet|haiku)-X(-Y)?`
  // from the id and rebuild a canonical key.
  const m = model.match(/(opus|sonnet|haiku)-(\d+(?:-\d+)?)/);
  if (m) {
    const key = `claude-${m[1]}-${m[2]}`;
    if (PRICING[key]) return PRICING[key] ?? null;
  }
  return null;
}

/** Compute the USD cost of one Claude API turn from its usage record. */
export function computeCost(model: string, usage: Usage): CostBreakdown | null {
  const rates = lookupRates(model);
  if (!rates) return null;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const usd =
    (inputTokens * rates.input +
      outputTokens * rates.output +
      cacheCreationTokens * rates.cacheWrite5m +
      cacheReadTokens * rates.cacheRead) /
    1_000_000;
  return {
    usd,
    model,
    rates,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  };
}

/** Format a cost breakdown as a single human-readable line. */
export function formatCost(c: CostBreakdown): string {
  const cache: string[] = [];
  if (c.cacheReadTokens > 0) cache.push(`+${c.cacheReadTokens} cache_r`);
  if (c.cacheCreationTokens > 0) cache.push(`+${c.cacheCreationTokens} cache_w`);
  const cacheStr = cache.length ? ` ${cache.join(" ")}` : "";
  return `cost $${c.usd.toFixed(4)} · in=${c.inputTokens}${cacheStr} out=${c.outputTokens} · ${c.model}`;
}
