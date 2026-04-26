import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunContext } from "@effect/platform-bun";
import { Effect, Exit, Layer } from "effect";
import { BuildLive, BuildService } from "./Build";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mochi-build-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const provide = <A, E>(eff: Effect.Effect<A, E, BuildService>) =>
  Effect.runPromiseExit(
    eff.pipe(Effect.provide(BuildLive.pipe(Layer.provide(BunContext.layer)))),
  );

// Plain TS in a .tsx file — no JSX or imports — keeps the bundle test
// hermetic. We're exercising the bundler/template pipeline, not React.
const goodTsx = `
const root = document.getElementById("root");
if (root) root.textContent = "hello world";
`;

describe("Build", () => {
  test("bundles a simple tsx → bundle.js + index.html", async () => {
    writeFileSync(join(dir, "index.tsx"), goodTsx);
    const exit = await provide(
      Effect.gen(function* () {
        const b = yield* BuildService;
        yield* b.bundle(dir, "Tic-Tac-Toe");
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(existsSync(join(dir, "bundle.js"))).toBe(true);
    expect(existsSync(join(dir, "index.html"))).toBe(true);
    const html = readFileSync(join(dir, "index.html"), "utf8");
    expect(html).toContain("<title>Tic-Tac-Toe</title>");
    expect(html).toContain('src="./bundle.js"');
  });

  test("missing index.tsx → BuildError", async () => {
    const exit = await provide(
      Effect.gen(function* () {
        const b = yield* BuildService;
        yield* b.bundle(dir, "Nope");
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("index.tsx is missing");
    }
  });

  test("syntactically broken tsx → BuildError", async () => {
    writeFileSync(join(dir, "index.tsx"), "this is not (valid) typescript {{{");
    const exit = await provide(
      Effect.gen(function* () {
        const b = yield* BuildService;
        yield* b.bundle(dir, "Broken");
      }),
    );
    // Bun.build either rejects with an Error ("Bundle failed") or returns
    // result.success=false ("bundling index.tsx failed"); we accept either.
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const c = JSON.stringify(exit.cause);
      expect(c).toContain("BuildError");
    }
  });

  test("escapes HTML special chars in title", async () => {
    writeFileSync(join(dir, "index.tsx"), goodTsx);
    await provide(
      Effect.gen(function* () {
        const b = yield* BuildService;
        yield* b.bundle(dir, "<script>alert(1)</script>");
      }),
    );
    const html = readFileSync(join(dir, "index.html"), "utf8");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
