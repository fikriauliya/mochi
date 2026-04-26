# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Mochi is

Mochi is a **family agentic app studio**, not a chatbot. A family member describes what they want (by voice or text); the host generates one of two output kinds inside `apps/<id>/`:

- **`kind: "app"`** — a real `claude -p` subprocess writes a self-contained React + TypeScript app, then `Bun.build` bundles it. Modify reuses the same Claude session via `claude --resume <session-id>`, so each follow-up edit threads through the prior conversation.
- **`kind: "printable"`** — OpenAI's `gpt-image-2` (low quality) generates a portrait infographic PNG; the host saves `print.png` and a tiny static `index.html` that displays it with `@page { size: A4; margin: 0 }` so `window.print()` produces a borderless A4 page. Modify regenerates from the accumulated prompt history (no `--resume` for image generation).

Both kinds share the same registry, library, build/SSE pipeline, and open view; the differentiation is internal. Voice/text composer pre-selects the kind via the home button you tapped (🎙 *Tap & talk* → app, 🖨 *Make a printable* → printable).

There is one UI: **kid mode**. It's voice-first (Web Speech API + SpeechSynthesis), with text input as a fallback for adults and a TV remote / D-pad–friendly focus model. Default UI copy is English; STT + TTS default to Indonesian (`id-ID`) and toggle via a `🎙 ID/EN` chip in the corner.

The product runs in three places:

- **The Mac (or any host)** runs `bun src/index.ts` — that's the brains.
- **A browser** (any device on the same LAN) loads `http://<host-ip>:3000`.
- **`android/`** is a thin Kotlin WebView shell so an Android TV (or phone) can host the same UI as a real installable app, with a configurable host URL stored in SharedPreferences.

## Stack discipline (Bun-first, no Node tooling)

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun install` / `bun run <script>` / `bunx <package>` — never npm/yarn/pnpm/npx.
- Use `bun test` instead of `jest` / `vitest`.
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` / `esbuild`.
- `Bun.serve()` for HTTP (supports WebSockets, HTTPS, route patterns). Don't pull in `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`. (The app registry lives at `data/mochi.db`.)
- `Bun.file` over `node:fs` reads/writes; `Bun.$` over `execa`.
- `WebSocket` is built-in; don't use `ws`.
- Bun auto-loads `.env` — don't add `dotenv`.
- HTML imports work natively: `import index from "./index.html"` and Bun's bundler handles linked `.tsx` and `.css`. Don't introduce Vite.
- Bun docs live in `node_modules/bun-types/docs/**.mdx` — read those when in doubt about an API.

## Common commands (via Taskfile)

The `Taskfile.yml` at the repo root captures every workflow. Run `task --list` to see them.

```
task dev                     # bun --hot src/index.ts (foreground, with HMR)
task serve                   # background server → /tmp/mochi.log
task serve:prod              # NODE_ENV=production background server (no HMR)
task serve:stop              # kill it
task serve:log               # tail -f /tmp/mochi.log
task ip                      # the LAN IP your TV / iPad needs

task adb:tv                  # adb connect 192.168.1.6:5555
task adb:phone               # adb connect 192.168.1.4:44329
task adb:pair IP=… PAIR_PORT=… PIN=…
task adb:scan                # mDNS scan for nearby ADB devices

task android:build           # ./gradlew assembleDebug
task android:install         # build + adb install (TARGET=tv|phone)
task android:run             # build + install + am start
task android:logcat          # filtered logcat for the Mochi app

task apps:list               # current contents of the registry
task apps:clean              # WIPE apps/ + SQLite (with confirm)
task apps:upgrade-tv         # bulk-modify every "ready" app via /api/apps/:id/modify
task apps:retitle-en         # translate every name/emoji/description to English (DRY=1, ONLY=<id>)

task https:start             # tailscale serve → https://<machine>.<tailnet>.ts.net
task https:stop              # tailscale serve reset
task https:status            # current mapping + public URL

task firewall:allow-bun      # add bun to macOS Application Firewall (sudo)
task check                   # bunx tsc --noEmit
task test                    # bun test src/server (single file: bun test src/server/Jobs.test.ts)
```

The Taskfile resolves `adb` and `JAVA_HOME` to absolute paths under `ANDROID_HOME` and Android Studio's bundled JBR, so it does **not** depend on the caller sourcing `~/.zshrc` (the user added the SDK to their PATH there, but a fresh shell or a CI runner won't have it).

## Architecture — the big picture

### Backend is Effect-TS

Everything in `src/server/` is built on Effect-TS (`effect`, `@effect/platform`, `@effect/platform-bun`). Read these files together; they make sense as one graph:

- **`Schema.ts`** — `effect/Schema` definitions for every wire type: `App`, `CreateAppRequest`, `ModifyAppRequest`, `Manifest`, `BuildEvent`, `ClaudeStreamEvent`. The `App` type also defines the on-disk shape stored in SQLite.
- **`Registry.ts`** — `RegistryService` over `data/mochi.db` (SQLite via `bun:sqlite`, WAL mode). Prepared statements, no in-memory cache — every read hits SQLite directly so external mutations are picked up without a server restart.
- **`Claude.ts`** — `ClaudeService.spawn` wraps `claude --print --output-format stream-json --include-partial-messages …` via `@effect/platform/Command`. The subprocess is owned by an `Effect.Scope` so it dies with the request that started it. JSONL stdout is decoded one line at a time into a typed `Stream<ClaudeStreamEvent>`. Model defaults to `sonnet` (`MOCHI_CLAUDE_MODEL=opus` in `.env` to upgrade) and `--effort low` (`MOCHI_CLAUDE_EFFORT=medium|high|xhigh|max`). Without the effort floor sonnet drifts into multi-minute extended-thinking on short prompts.
- **`Build.ts`** — `BuildService.bundle(cwd, title)` runs `Bun.build` on `apps/<id>/index.tsx` after Claude finishes successfully, producing `bundle.js` + a server-templated `index.html` that mounts it. Bundle is minified + browser ESM.
- **`Jobs.ts`** — orchestrator. `Jobs.start(id, kind, prompt)` forks a daemon fiber that consumes the Claude stream, projects each raw event into a leaner `BuildEvent`, fans them out via a per-app `PubSub<BuildEvent>`, then on stream-success reads `manifest.json`, runs `Build.bundle`, and updates the registry. `Jobs.subscribe(id)` returns a `Stream<BuildEvent>` for SSE consumers (multiple browser tabs can watch the same build); a late subscriber gets a one-shot terminal `done`/`error` from the registry so EventSource doesn't spuriously reconnect. Also tracks the active model from the `system/init` event and emits a `cost $… · in=… +cache_r out=…` status line on each `result` event using `Pricing.computeCost`.
- **`Pricing.ts`** — pure-data table of per-million-token rates for every supported Claude model, plus `lookupRates` (handles trailing `-YYYYMMDD` date suffixes and a family/version fallback for unknown variants), `computeCost`, and `formatCost`. No Effect dependencies; called directly from `Jobs.ts`.
- **`Printable.ts`** — Two methods, both using `OPENAI_API_KEY` (Bun auto-loads `.env`):
  - `generatePng(prompt)` calls `POST /v1/images/generations` (model `gpt-image-2`, `quality: "low"`, `size: "1024x1536"`, `output_format: "png"`) and decodes the `b64_json` payload. Wraps the prompt with infographic framing (portrait A4, kid-friendly, English text, ink-economical).
  - `generateMetadata(prompt)` calls `POST /v1/chat/completions` (model `gpt-4o-mini`, `response_format: json_object`) to translate any-language prompts into an English `{name, emoji, description}` manifest. Used both for new printables (in `Jobs.ts`) and for the `task apps:retitle-en` bulk-retitler.
  `Jobs.ts` calls these when `app.kind === "printable"` and skips the claude/bundler path entirely.
- **`Sse.ts`** — formats a `Stream<BuildEvent>` into `event: <type>\ndata: <json>\n\n` chunks for the SSE endpoint.
- **`HttpApi.ts`** — Bun.serve route table closed over the runtime. Every handler is an Effect; errors are funnelled through `handle()` → typed status codes. SSE responses are an `Effect.Stream<BuildEvent>` formatted as event-stream chunks via `Stream.toReadableStreamRuntime(stream, runtime)`. Also serves the PWA artifacts (`/manifest.webmanifest`, `/sw.js`, `/icons/:file`).
- **`Main.ts`** — composes `RegistryLive`, `ClaudeLive`, `BuildLive` as siblings, then `JobsLive` consumes them, all resolved against `BunContext.layer` (FileSystem, Path, CommandExecutor). `runServer` reaches `Effect.runtime` for the runtime, hands it to `makeRoutes`, calls `Bun.serve`, and `Effect.never`s. `BunRuntime.runMain` in `src/index.ts` owns the lifecycle.

Tests live alongside services as `src/server/*.test.ts` (`Schema`, `Registry`, `Build`, `Jobs`, `Pricing`) and run via `task test` / `bun test src/server`. `Build.test.ts` and the Tailwind-touching tests scaffold their fixtures inside the project root (under `apps/_test-build-*`) — never `/tmp` — because `bun-plugin-tailwind` resolves `tailwindcss` from the source directory, and `Bun.build` resolves `react`/`react-dom` from the nearest `node_modules`.

The HTTP routes:

| Method | Path                       | Effect                                                         |
|--------|----------------------------|----------------------------------------------------------------|
| GET    | `/api/apps`                | `Registry.list`                                                |
| POST   | `/api/apps`                | mint id+sessionId → `Registry.upsert(building)` → `Jobs.start` |
| GET    | `/api/apps/:id`            | `Registry.get`                                                 |
| GET    | `/api/apps/:id/stream`     | `Jobs.subscribe(id)` → SSE                                     |
| POST   | `/api/apps/:id/modify`     | `Jobs.start(id, "modify", prompt)` (reuses `--resume`)         |
| DELETE | `/api/apps/:id`            | `Registry.remove`                                              |
| GET    | `/apps/:id/*`              | static-serve `apps/<id>/<rest>` (path traversal blocked)       |
| GET    | `/manifest.webmanifest`    | PWA manifest                                                   |
| GET    | `/sw.js`                   | service worker (registered only on HTTPS / localhost)          |
| GET    | `/icons/:file`             | served from `src/icons/` (PWA + apple-touch-icon)              |
| GET    | `/*`                       | SPA fallback — Bun HTML import                                 |

### The agent's file contract (kind = "app")

The `SYSTEM_PROMPT` in `src/server/Claude.ts` constrains generated apps. The agent writes exactly two files in its cwd (`apps/<id>/`):

1. **`index.tsx`** — a React 19 app. Imports from `react` / `react-dom` only (no other npm). Mounts `createRoot(...).render(<App />)` into `<div id="root">`. State lives in component state and/or `localStorage` — no backend. **Styling is Tailwind utility classes only** — no `<style>` tags, no inline CSS objects, no external stylesheets. UI text is always English regardless of the input prompt's language.
2. **`manifest.json`** — `{ name, emoji, description }` validated against the `Manifest` schema.

After Claude exits cleanly, the server reads the manifest, then `Build.ts` runs `Bun.build({ entrypoints: ["index.tsx", "styles.css"], plugins: [tailwindPlugin], minify: true })` — `Build.ts` pre-creates a one-line `styles.css` (`@import "tailwindcss";`) if the agent didn't write one. The output is `bundle.js` + `bundle.css` (the JIT-extracted Tailwind), and `Build.ts` writes a fixed `index.html` shell that loads both. So `/apps/<id>/` is always served by the host: never `claude` directly. Build errors fold into the existing terminal `error` `BuildEvent` with the compile logs.

### Printable contract (kind = "printable")

No agent runs. `Jobs.ts` calls `PrintableService.generatePng(prompt)`, then writes three files into `apps/<id>/`:

1. **`print.png`** — the gpt-image-2 output (1024×1536 PNG).
2. **`index.html`** — a fixed static shell (no React, no JS) that displays the PNG centered, with `@page { size: A4 portrait; margin: 0 }` and `@media print { img { width: 100vw; height: 100vh; object-fit: contain } }`. The frontend's `KidOpenView` shows a 🖨 Print button that calls `iframeRef.current.contentWindow.print()` to invoke the browser's print dialog.
3. **`manifest.json`** — synthesized server-side from the prompt: `name = first line truncated to 60 chars`, `emoji = "🖨"`, `description = first 280 chars of the accumulated prompt`.

**Set `OPENAI_API_KEY` in `.env`** — Bun auto-loads it. Without the key, printable builds fail fast with a clear error message; the rest of Mochi is unaffected.

Modify on a printable concatenates the new prompt onto the previous one (`${app.prompt}\n\nNow also: ${newPrompt}`) so the regenerated image evolves rather than starting fresh; the combined prompt is persisted back to `app.prompt` for the next round.

### Frontend (`src/`)

One UI tree, three view kinds matching the URL: `home / build / open`. URL is mutated via the History API; `popstate` keeps the React state in sync. State machine + route mapping live in `src/App.tsx`.

- **`App.tsx`** — view state, app list (`listApps`), and the action callbacks (`onCreate`, `onModify`, `onOpenApp`, `onBuildDone`, `onReload`). Always renders `<KidShell />`.
- **`components/KidShell.tsx`** — the entire UI. One file because the views share state and primitives (mic overlay, type overlay, app menu). Routes between `KidHome / KidBuildView / KidOpenView` based on the view prop. Long-press a tile (700 ms) **or** tap the visible `⋯` corner button to open the app menu (Open / Modify / Open in tab / Delete). The mic overlay can swap to the type overlay mid-recording, carrying any partial transcript as a seed.
- **`components/Mochi.tsx`** — the inline-SVG mascot. Animated breathing/blink idle + `typing` (squish + steam) + `happy` mouth state. Don't rebuild it from scratch.
- **`components/AgentLog.tsx`** — pretty-prints streamed `BuildEvent`s. Used in `KidBuildView`'s collapsible "Watch Mochi work" panel. Honours a `verbose` prop (persisted to `localStorage`) that surfaces raw `ClaudeStreamEvent` JSON and the `cost …` status line; non-verbose mode hides them.
- **`lib/speech.ts`** — `useSpeech` hook around `webkitSpeechRecognition`. Has a configurable `silenceMs` (default 800 ms) that hard-stops the recognizer after a pause so short utterances don't wait for the browser's slow built-in end-of-speech detection. Falls back gracefully when the API is missing. `useSpeechLang()` persists `id-ID`/`en-US` in `localStorage`.
- **`lib/tts.ts`** — thin `speak(text, lang)` wrapper that cancels any in-flight utterance first.
- **`lib/api.ts`** — typed `fetch` wrappers for `/api/apps/*`. `subscribeStream(appId, onEvent)` opens an `EventSource` and registers handlers per `BuildEvent.type`.
- **`styles/globals.css`** — Tailwind v4 `@theme` block defining the cream/paper palette and Fraunces (display) + Nunito (body) typography. The mascot's breathing/squish/steam keyframes live in `src/index.css`.
- **`tsconfig.json` excludes `apps/`** — agent-generated TSX is built by `Bun.build`, not type-checked by the host project.

### Android shell (`android/`)

Single Kotlin Activity wrapping a `WebView`. Targets phone, tablet, and Android TV from one APK (`LEANBACK_LAUNCHER` intent puts the icon on the TV home rail; `uses-feature` flags don't require touchscreen or mic).

Two non-obvious bits:

- **Mic permission**: the WebView's `onPermissionRequest` doesn't actually grant microphone access on Android — only the OS-level `RECORD_AUDIO` runtime permission does. `MainActivity.handleWebPermissionRequest` checks `ContextCompat.checkSelfPermission`, stashes the WebView's `PermissionRequest` if not granted, calls `ActivityCompat.requestPermissions`, then resolves the stashed request from `onRequestPermissionsResult`. Don't simplify this back to a bare `request.grant`.
- **Cleartext + LAN**: `network_security_config.xml` permits cleartext globally because the Mochi server runs on plain HTTP on the family's LAN. The shell asks for the URL on first launch (e.g. `http://192.168.1.42:3000`) and stores it in SharedPreferences. Long-press BACK or press MENU on the remote to reopen the settings dialog.

Before the device can reach the dev server, the macOS Application Firewall needs to allow `bun`. Use `task firewall:allow-bun`. Restart the bun process afterwards — the firewall rule binds at process start.

### Browser secure-context caveat

`getUserMedia` and Web Speech are gated to secure contexts in real browsers (Chrome / Safari). On `localhost` they work; on plain LAN HTTP from another device's browser (e.g. iPad) they're silently blocked. The Android WebView shell doesn't enforce this, which is why voice works there over HTTP. For non-shell browser testing, type-mode is the fallback; voice would need HTTPS (Tailscale Funnel, ngrok, or a self-signed cert + trust profile).

## Things to be careful about

- **Bun.serve route wildcards**: `req.params["*"]` is *not* populated for `/foo/:id/*`. Recover the rest from `req.url`'s pathname (see `serveAppFile` in `HttpApi.ts`).
- **Restart bun after firewall changes.** The macOS Application Firewall caches its allow/deny decision per running process at start time. A long-running bun stays under the old policy until you `kill -9` and restart.
- **Don't serialize tile state from a `<button>` containing nested `<button>`s.** The tile in `KidShell` uses a `div` with two siblings (body + corner ⋯) precisely because nested buttons are invalid HTML and Safari/iOS can route taps unpredictably.
- **`tsconfig.json` excludes `apps/`** so `task check` doesn't trip on agent-generated TSX. If you add new top-level dirs that contain TS, exclude them too (or you'll get spurious failures).
- **Don't scaffold Tailwind/`Bun.build` test fixtures in `/tmp`.** `bun-plugin-tailwind` resolves the `tailwindcss` package from the source directory, and `Bun.build` resolves `react`/`react-dom` from the nearest `node_modules` — both fail outside the project root. Tests put fixtures under `apps/_test-build-*` and clean up on teardown.
- **PWA manifest must not be a `<link>` in `index.html`.** Bun's HTML bundler tries to resolve it as a build-time asset and emits an empty file. `src/frontend.tsx` injects the `<link rel="manifest">` and `<link rel="apple-touch-icon">` at runtime instead; the meta tags (`apple-mobile-web-app-capable`, etc.) stay in `src/index.html`.
