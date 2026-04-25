import { FileSystem, Path } from "@effect/platform";
import { Context, Data, Effect, Layer } from "effect";

export class BuildError extends Data.TaggedError("BuildError")<{
  readonly message: string;
  readonly logs?: string;
}> {}

export class BuildService extends Context.Tag("BuildService")<
  BuildService,
  {
    /**
     * Bundle `apps/<id>/index.tsx` into `apps/<id>/bundle.js`, then write
     * `apps/<id>/index.html` from a template that mounts the bundle. Throws
     * `BuildError` if compilation fails or required files are missing.
     */
    readonly bundle: (
      cwd: string,
      title: string,
    ) => Effect.Effect<void, BuildError>;
  }
>() {}

const indexHtmlTemplate = (title: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    #root { min-height: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./bundle.js"></script>
</body>
</html>
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const BuildLive = Layer.effect(
  BuildService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return BuildService.of({
      bundle: (cwd, title) =>
        Effect.gen(function* () {
          const entrypoint = path.join(cwd, "index.tsx");

          const exists = yield* fs.exists(entrypoint).pipe(
            Effect.mapError(
              () =>
                new BuildError({ message: "could not stat index.tsx" }),
            ),
          );
          if (!exists) {
            return yield* Effect.fail(
              new BuildError({
                message: "index.tsx is missing — the agent must produce it",
              }),
            );
          }

          const result = yield* Effect.tryPromise({
            try: () =>
              Bun.build({
                entrypoints: [entrypoint],
                outdir: cwd,
                target: "browser",
                format: "esm",
                naming: "[dir]/bundle.js",
                minify: true,
                sourcemap: "none",
                splitting: false,
                define: {
                  "process.env.NODE_ENV": JSON.stringify("production"),
                },
              }),
            catch: (cause) =>
              new BuildError({
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          });

          if (!result.success) {
            const logs = result.logs.map((l) => String(l)).join("\n");
            return yield* Effect.fail(
              new BuildError({
                message: `bundling index.tsx failed (${result.logs.length} ${
                  result.logs.length === 1 ? "issue" : "issues"
                })`,
                logs,
              }),
            );
          }

          // Server-owned index.html template — keeps the contract narrow:
          // the agent only writes index.tsx + manifest.json, the shell is
          // ours.
          yield* fs
            .writeFileString(
              path.join(cwd, "index.html"),
              indexHtmlTemplate(title),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new BuildError({
                    message: "failed to write index.html",
                    logs: String(cause),
                  }),
              ),
            );
        }),
    });
  }),
);
