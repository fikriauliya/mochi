import { Data, Effect } from "effect";

/**
 * One-shot `claude --print --output-format=json --json-schema=…` calls,
 * shared by `Organize.ts` and `Suggest.ts`. Both want:
 *
 *   - sonnet at low effort, no MCP, no plugins, no tools, no skills
 *   - a strict json schema constraining the response
 *   - the subprocess killed on interrupt / timeout / failure (otherwise
 *     a stuck claude leaks past the calling Effect)
 *   - a defensive walk to find the schema-validated payload (claude
 *     lands it at `.structured_output`; older versions used `.result`)
 *
 * The streaming app-build path (Claude.ts) is intentionally separate —
 * it owns a session id, supports `--resume`, captures stderr through a
 * Ref, and decodes JSONL one line at a time.
 */

export class SonnetJsonError extends Data.TaggedError("SonnetJsonError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type SonnetJsonOptions = {
  readonly prompt: string;
  /** Stringified JSON schema passed to `--json-schema`. */
  readonly schema: string;
  /** Defaults to "sonnet". */
  readonly model?: string;
  /** Defaults to "low". */
  readonly effort?: string;
};

/**
 * Spawn claude, wait for it, return the parsed top-level JSON response
 * (still `unknown` — caller validates shape with `unwrapStructured`
 * + a field check). `acquireUseRelease` guarantees the subprocess is
 * killed on every exit path.
 */
export function callJsonSchema(
  opts: SonnetJsonOptions,
): Effect.Effect<unknown, SonnetJsonError> {
  return Effect.acquireUseRelease(
    Effect.sync(() =>
      Bun.spawn(
        [
          "claude",
          "--print",
          "--model",
          opts.model ?? "sonnet",
          "--effort",
          opts.effort ?? "low",
          "--output-format",
          "json",
          "--json-schema",
          opts.schema,
          "--permission-mode",
          "bypassPermissions",
          // `--tools` is variadic — `--strict-mcp-config` (boolean) right
          // after the empty value stops it slurping the prompt.
          "--tools",
          "",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--disable-slash-commands",
          "--setting-sources",
          "",
          "--exclude-dynamic-system-prompt-sections",
          opts.prompt,
        ],
        { stdout: "pipe", stderr: "pipe" },
      ),
    ),
    (proc) =>
      Effect.tryPromise({
        try: async () => {
          const stdout = await new Response(proc.stdout).text();
          const code = await proc.exited;
          if (code !== 0) {
            const stderr = await new Response(proc.stderr).text();
            throw new Error(
              `claude exited ${code}: ${stderr.slice(0, 500)}`,
            );
          }
          return JSON.parse(stdout) as unknown;
        },
        catch: (cause) =>
          new SonnetJsonError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
    (proc) =>
      Effect.sync(() => {
        try {
          proc.kill();
        } catch {
          /* already exited */
        }
      }),
  );
}

/**
 * Find the schema-validated object inside claude's `--output-format=json
 * --json-schema=…` response. Returns the inner record on success, null
 * if no candidate is an object. Caller then validates field shape.
 */
export function unwrapStructured(
  parsed: unknown,
): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  for (const c of [p["structured_output"], p["result"], parsed]) {
    if (c && typeof c === "object") return c as Record<string, unknown>;
  }
  return null;
}
