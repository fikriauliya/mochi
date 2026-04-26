import { FileSystem, Path } from "@effect/platform";
import tailwindPlugin from "bun-plugin-tailwind";
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
    /**
     * Drop the host-owned helper files (`shared.tsx` + `styles.css`) into
     * `cwd`. Called by `Jobs.ts` BEFORE spawning claude so the agent can
     * `Read("./shared.tsx")` to inspect exported helpers, and so its
     * `import "./shared"` resolves at bundle time without us racing to
     * write the file mid-build.
     */
    readonly seed: (cwd: string) => Effect.Effect<void, BuildError>;
  }
>() {}

const indexHtmlTemplate = (title: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./bundle.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./bundle.js"></script>
</body>
</html>
`;

// Tailwind entrypoint + a small set of host-owned utility classes the
// generated apps reference (.app-shell, .app-btn, .app-h1/h2/display/body
// /tiny). Centralising these saves the agent from re-emitting ~80–120 chars
// of `pt-[max(20px,env(safe-area-inset-top))]` / `text-[clamp(...)]` /
// `focus-visible:ring-…` strings on every element. bun-plugin-tailwind
// processes the @apply directives during build.
const STYLES_CSS = `@import "tailwindcss";

@layer components {
  .app-shell {
    @apply min-h-screen flex flex-col items-center;
    padding-top: max(20px, env(safe-area-inset-top));
    padding-bottom: max(20px, env(safe-area-inset-bottom));
    padding-left: max(20px, env(safe-area-inset-left));
    padding-right: max(20px, env(safe-area-inset-right));
  }
  .app-btn {
    @apply min-h-14 px-4 rounded-2xl font-semibold transition-colors;
    @apply focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500 focus-visible:ring-offset-2;
  }
  .app-h1      { font-size: clamp(1.75rem, 6vw, 3.5rem);   line-height: 1.1; @apply font-bold; }
  .app-h2      { font-size: clamp(1.25rem, 4vw, 2.25rem);  line-height: 1.2; @apply font-bold; }
  .app-display { font-size: clamp(2rem, 7vw, 4rem);        line-height: 1;   @apply font-bold; }
  .app-body    { font-size: clamp(1.125rem, 2.5vw, 1.75rem); }
  .app-tiny    { font-size: clamp(0.85rem, 1.5vw, 1.1rem); }
}
`;

// Audio + mute helpers seeded into apps/<id>/shared.tsx so generated apps
// can `import { playTone, useMute } from "./shared"` instead of writing
// ~25 lines of AudioContext + localStorage scaffolding every build.
const SHARED_TSX = `import { useCallback, useState } from "react";

let ctx: AudioContext | null = null;
const isMuted = (): boolean =>
  typeof localStorage !== "undefined" && localStorage.getItem("muted") === "1";

/**
 * Synthesize a short tone for kid-friendly UI feedback. Auto-respects mute.
 * Lazily creates one AudioContext on first call (autoplay policies block
 * pre-interaction). Quiet by default — TVs amplify everything.
 */
export function playTone(freq = 440, durationMs = 80, peakGain = 0.15): void {
  if (isMuted()) return;
  try {
    if (!ctx) ctx = new AudioContext();
    const c = ctx;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.frequency.value = freq;
    const t = c.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peakGain, t + 0.01);
    gain.gain.linearRampToValueAtTime(0, t + durationMs / 1000);
    osc.start(t);
    osc.stop(t + durationMs / 1000);
  } catch {
    /* AudioContext unavailable — silent fallback is fine */
  }
}

/** Persisted mute toggle. Returns [muted, toggle]. */
export function useMute(): [boolean, () => void] {
  const [muted, setMuted] = useState<boolean>(() => isMuted());
  const toggle = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      localStorage.setItem("muted", next ? "1" : "0");
      return next;
    });
  }, []);
  return [muted, toggle];
}
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

    /**
     * Idempotent: writes the file only if it doesn't already exist, so
     * pre-seeding before claude (Jobs) and the safety re-seed before
     * bundle (here) play nicely together.
     */
    const writeIfMissing = (p: string, source: string, label: string) =>
      Effect.gen(function* () {
        const present = yield* fs.exists(p).pipe(
          Effect.mapError(
            () => new BuildError({ message: `could not stat ${label}` }),
          ),
        );
        if (present) return;
        yield* fs.writeFileString(p, source).pipe(
          Effect.mapError(
            (cause) =>
              new BuildError({
                message: `failed to seed ${label}`,
                logs: String(cause),
              }),
          ),
        );
      });

    const seed = (cwd: string) =>
      Effect.gen(function* () {
        yield* writeIfMissing(
          path.join(cwd, "styles.css"),
          STYLES_CSS,
          "styles.css",
        );
        yield* writeIfMissing(
          path.join(cwd, "shared.tsx"),
          SHARED_TSX,
          "shared.tsx",
        );
      });

    return BuildService.of({
      seed,
      bundle: (cwd, title) =>
        Effect.gen(function* () {
          const entrypoint = path.join(cwd, "index.tsx");
          const stylesPath = path.join(cwd, "styles.css");

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

          // Defence in depth — Jobs.ts seeds these before spawning claude
          // so the agent can Read them, but if anyone ever bypasses that
          // path we still bundle correctly.
          yield* seed(cwd);

          const result = yield* Effect.tryPromise({
            try: () =>
              Bun.build({
                entrypoints: [entrypoint, stylesPath],
                outdir: cwd,
                target: "browser",
                format: "esm",
                // Two entrypoints with different extensions both land at
                // bundle.js / bundle.css.
                naming: "[dir]/bundle.[ext]",
                minify: true,
                sourcemap: "none",
                splitting: false,
                plugins: [tailwindPlugin],
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
