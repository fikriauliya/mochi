import Anthropic from "@anthropic-ai/sdk";
import { Data, Effect } from "effect";
import { resolveModelId, useApi } from "./ClaudeBackend";

/**
 * One-shot structured-output calls, shared by Organize / Suggest /
 * Narrator. Two backends behind one entry point — `MOCHI_CLAUDE_BACKEND`
 * picks at runtime.
 *
 *   cli (default): `claude --print --output-format=json --json-schema=…`
 *     subprocess. No API key, uses claude code login.
 *   api: Anthropic Messages API with a forced `tool_use` whose
 *     `input_schema` IS the json schema. Faster TTFB, no subprocess
 *     overhead. Requires ANTHROPIC_API_KEY.
 *
 * Both return the same { structured_output } envelope so
 * `unwrapStructured` works without branching downstream.
 *
 * The streaming app-build path (Claude.ts) is intentionally separate —
 * it owns a session id, supports `--resume`, and decodes JSONL events
 * one line at a time.
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
 * Returns the parsed top-level JSON response (still `unknown` — caller
 * validates shape with `unwrapStructured` + a field check). Dispatches
 * on `MOCHI_CLAUDE_BACKEND`; both implementations wrap the validated
 * payload in `{ structured_output }` so the caller doesn't branch.
 */
export function callJsonSchema(
  opts: SonnetJsonOptions,
): Effect.Effect<unknown, SonnetJsonError> {
  return useApi() ? callViaApi(opts) : callViaCli(opts);
}

function callViaCli(
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

function callViaApi(
  opts: SonnetJsonOptions,
): Effect.Effect<unknown, SonnetJsonError> {
  return Effect.tryPromise({
    try: async () => {
      const apiKey = process.env["ANTHROPIC_API_KEY"];
      if (!apiKey) {
        throw new Error(
          "MOCHI_CLAUDE_BACKEND=api requires ANTHROPIC_API_KEY in .env",
        );
      }
      const client = new Anthropic({ apiKey });
      const inputSchema = JSON.parse(opts.schema) as Record<string, unknown>;
      const res = await client.messages.create({
        model: resolveModelId(opts.model ?? "sonnet"),
        max_tokens: 1024,
        // Force the model to call this single tool whose input_schema is
        // exactly our json schema — Anthropic validates the args against
        // it, giving us schema-conformant structured output.
        tools: [
          {
            name: "respond",
            description: "Send the structured response.",
            input_schema: inputSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: "respond" },
        messages: [{ role: "user", content: opts.prompt }],
      });
      const block = res.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        throw new Error("API returned no tool_use block");
      }
      // Wrap so `unwrapStructured()` works downstream without branching.
      return { structured_output: block.input };
    },
    catch: (cause) =>
      new SonnetJsonError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
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
