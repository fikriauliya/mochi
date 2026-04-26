/**
 * Single source of truth for the Claude backend toggle. Three call
 * sites read this:
 *
 *   1. `SonnetJson.callJsonSchema` — JSON-schema completions used by
 *      Suggest / Organize.
 *   2. `Vision.scanWorksheet` — image → spec for the worksheet scanner.
 *   3. `Claude.spawn` — the agentic build path.
 *
 * `MOCHI_CLAUDE_BACKEND` flips them in lockstep so we can A/B the two
 * implementations against the same UI.
 *
 *   cli (default): `claude` CLI subprocesses for everything; auth
 *     comes from the user's claude code login. No API key needed.
 *   api: Anthropic Messages API for the simple completions and the
 *     vision call; Claude Agent SDK (`query()`) for the build path.
 *     Requires `ANTHROPIC_API_KEY` in `.env`.
 */

export type ClaudeBackend = "cli" | "api";

export function claudeBackend(): ClaudeBackend {
  const v = process.env["MOCHI_CLAUDE_BACKEND"]?.toLowerCase();
  return v === "api" ? "api" : "cli";
}

export function useApi(): boolean {
  return claudeBackend() === "api";
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "MOCHI_CLAUDE_BACKEND=api requires ANTHROPIC_API_KEY in .env. Get one at https://console.anthropic.com/.",
    );
    this.name = "MissingApiKeyError";
  }
}

export function requireAnthropicKey(): string {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) throw new MissingApiKeyError();
  return key;
}

/**
 * The CLI accepts shortcuts ("opus", "sonnet", "haiku") plus any full
 * model id. The Anthropic SDK only accepts full ids. Map shortcuts to
 * the latest published id; pass anything else through.
 */
export function resolveModelId(name: string): string {
  if (name.includes("-")) return name;
  if (name === "opus") return "claude-opus-4-7";
  if (name === "sonnet") return "claude-sonnet-4-6";
  if (name === "haiku") return "claude-haiku-4-5";
  return name;
}
