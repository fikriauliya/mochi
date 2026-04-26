import { describe, expect, test } from "bun:test";
import { computeCost, formatCost, lookupRates, PRICING } from "./Pricing";

describe("lookupRates", () => {
  test("exact match", () => {
    expect(lookupRates("claude-opus-4-7")).toBe(PRICING["claude-opus-4-7"]!);
  });

  test("strips trailing -YYYYMMDD date suffix", () => {
    expect(lookupRates("claude-opus-4-7-20260101")).toBe(PRICING["claude-opus-4-7"]!);
    expect(lookupRates("claude-haiku-4-5-20251001")).toBe(PRICING["claude-haiku-4-5"]!);
  });

  test("falls back to family+version pattern", () => {
    expect(lookupRates("foo-claude-sonnet-4-6-bar")).toBe(PRICING["claude-sonnet-4-6"]!);
  });

  test("returns null for unknown model", () => {
    expect(lookupRates("gpt-4")).toBeNull();
    expect(lookupRates("")).toBeNull();
  });
});

describe("computeCost", () => {
  test("opus 4.7: 50k input + 15k output → known total", () => {
    const cost = computeCost("claude-opus-4-7", {
      input_tokens: 50_000,
      output_tokens: 15_000,
    });
    expect(cost).not.toBeNull();
    if (cost) {
      // 50k * $5 + 15k * $25 per million = $0.25 + $0.375 = $0.625
      expect(cost.usd).toBeCloseTo(0.625, 6);
      expect(cost.inputTokens).toBe(50_000);
      expect(cost.outputTokens).toBe(15_000);
    }
  });

  test("includes cache reads at 0.10× input rate", () => {
    const cost = computeCost("claude-opus-4-7", {
      input_tokens: 10_000,
      output_tokens: 0,
      cache_read_input_tokens: 40_000,
    });
    expect(cost).not.toBeNull();
    if (cost) {
      // 10k * $5 + 40k * $0.50 per million = $0.05 + $0.02 = $0.07
      expect(cost.usd).toBeCloseTo(0.07, 6);
      expect(cost.cacheReadTokens).toBe(40_000);
    }
  });

  test("includes 5m cache writes at 1.25× input rate", () => {
    const cost = computeCost("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(cost).not.toBeNull();
    if (cost) {
      // 1M * $3.75 = $3.75 (matches the docs' 1.25× sonnet rate)
      expect(cost.usd).toBeCloseTo(3.75, 6);
    }
  });

  test("haiku 4.5 is cheap relative to opus 4.7", () => {
    const usage = { input_tokens: 100_000, output_tokens: 100_000 };
    const opus = computeCost("claude-opus-4-7", usage);
    const haiku = computeCost("claude-haiku-4-5", usage);
    expect(opus).not.toBeNull();
    expect(haiku).not.toBeNull();
    if (opus && haiku) {
      // Opus 4.7 is 5× input + 5× output of haiku 4.5 ($5 vs $1, $25 vs $5).
      expect(opus.usd / haiku.usd).toBeCloseTo(5, 2);
    }
  });

  test("unknown model → null", () => {
    expect(computeCost("gpt-4", { input_tokens: 100 })).toBeNull();
  });

  test("missing fields default to 0", () => {
    const cost = computeCost("claude-opus-4-7", {});
    expect(cost?.usd).toBe(0);
  });
});

describe("formatCost", () => {
  test("includes cache totals when non-zero", () => {
    const cost = computeCost("claude-opus-4-7", {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 40,
    });
    expect(cost).not.toBeNull();
    if (cost) {
      const line = formatCost(cost);
      expect(line).toContain("$");
      expect(line).toContain("in=10");
      expect(line).toContain("out=20");
      expect(line).toContain("+30 cache_r");
      expect(line).toContain("+40 cache_w");
      expect(line).toContain("claude-opus-4-7");
    }
  });

  test("omits cache parts when zero", () => {
    const cost = computeCost("claude-opus-4-7", {
      input_tokens: 1,
      output_tokens: 2,
    });
    expect(cost).not.toBeNull();
    if (cost) {
      const line = formatCost(cost);
      expect(line).not.toContain("cache_r");
      expect(line).not.toContain("cache_w");
    }
  });
});
