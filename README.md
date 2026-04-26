# Mochi

A family agentic app studio. A family member talks to **Mochi PM** (a voice agent) about what they want — or photographs a printed worksheet — and Mochi spins up a real, runnable web app or a printable infographic. The library on the home screen lists everything anyone has built; tap to open, long-press to modify by talking again.

It is not a chatbot. The output is a real artifact (a React app or a PNG sized for A4) that lives on disk and can be re-opened anytime.

Every Claude call (build, vision, organize, suggest) goes through one of **two backends**, picked by a single env flag — flip it to A/B them against the same UI:

- **`MOCHI_CLAUDE_BACKEND=cli`** *(default)* — invokes the local `claude` CLI (`claude --print` for builds, `claude --print --json-schema …` for one-shots). Auth comes from your claude code login. No API key needed.
- **`MOCHI_CLAUDE_BACKEND=api`** — uses `@anthropic-ai/claude-agent-sdk`'s `query()` for the agentic build path and `@anthropic-ai/sdk`'s Messages API for the simple structured-output calls. Requires `ANTHROPIC_API_KEY`.

Both backends produce the same `Stream<ClaudeStreamEvent>` shape downstream, so `Jobs.ts` doesn't branch on which is active.

```
                        ┌─────────────────────────────────┐
   "make me a            │  Claude — agent build           │      apps/<id>/index.tsx + manifest.json
    snake game"      ──► │   cli   : claude --print …      │ ───► bundled to bundle.js + bundle.css
   (via PM agent)        │   api   : @anthropic-ai/claude- │      served at /apps/<id>/
                         │           agent-sdk → query()   │
                         └─────────────────────────────────┘

                         ┌─────────────────────────────────┐
   📷  photo of           │  Claude (Opus) — vision         │     describes the page,
       printed         ──►│   cli : --tools Read --json-…   │ ──► hands a complete spec to the
       worksheet          │   api : POST /v1/messages       │     same /api/apps build pipeline
                         └─────────────────────────────────┘

                         ┌─────────────────────────────────┐
   "buatkan            ──►│  OpenAI gpt-image-2 (low qual)  │ ──► apps/<id>/print.png
    infografik           │  (always API, no CLI variant)    │      + a tiny print-CSS index.html
    sarapan sehat"       └─────────────────────────────────┘     🖨 Print → A4 borderless
```

## Three ways to start a build

- **🎙 Tap & talk** — opens the **Mochi PM** voice agent (ElevenLabs Conversational AI). It asks 2–4 short kid-friendly questions, then submits a complete English spec to the build pipeline.
- **🖨 Make a printable** — same voice agent, but the agent knows it's gathering requirements for a printable infographic; the spec ends up at `gpt-image-2`.
- **📷 Scan a worksheet** — the device camera photographs a printed maths sheet / coloring page / maze; **Claude Opus** (vision) reverse-engineers it into an interactive web-app spec, then the normal build runs.

Plus a text fallback for adults.

## Two output kinds

- **`kind: "app"`** — Claude (via the chosen backend) writes `index.tsx` + `manifest.json` into `apps/<id>/`; `Bun.build` bundles it. Modify reuses the same Claude session — `claude --resume <session-id>` in CLI mode, the SDK's `resume` option in API mode — so each follow-up edit threads through the prior conversation.
- **`kind: "printable"`** — OpenAI `gpt-image-2` (low quality, 1024×1536 portrait) renders an infographic; the host saves `print.png` and a static A4 print-CSS shell. The 🖨 Print button in the open view triggers `window.print()` borderless.

## Quick start

```bash
# 1. Install
bun install

# 2. Set up your .env (see "Required env" below)

# 3. Provision the PM agents in your ElevenLabs workspace (one-time;
#    two agents are created — one Indonesian-primary, one English-primary;
#    re-running the script PATCHes the existing ones)
bun src/server/PmAgent.ts
# → prints MOCHI_PM_AGENT_ID_ID=agent_… and MOCHI_PM_AGENT_ID_EN=agent_…
#   (paste both into .env)

# 4. Start the server (HMR)
task dev               # bun --hot src/index.ts
```

Open http://localhost:3000. From any device on the same Wi-Fi: `task ip` prints the LAN address.

For HTTPS-only browsers (iPad Safari needs HTTPS for the microphone + camera), `task https:start` exposes the same port via Tailscale at `https://<machine>.<tailnet>.ts.net`.

## Required env

Put these in `.env` — Bun auto-loads them.

```bash
# ElevenLabs powers the PM agents (Indonesian + English) and the
# /api/voice/tts endpoint that generated apps can use for read-aloud.
ELEVENLABS_API_KEY=...
MOCHI_PM_AGENT_ID_ID=agent_...        # Indonesian agent (default)
MOCHI_PM_AGENT_ID_EN=agent_...        # English agent
# Both printed by `bun src/server/PmAgent.ts`. Lang chip on the home
# screen picks which one to connect to per session.

# OpenAI powers printables + the dynamic-title gpt-4o-mini call
OPENAI_API_KEY=sk-...

# Backend toggle — see "Two Claude backends" above.
MOCHI_CLAUDE_BACKEND=cli              # cli (default) | api

# Required only when MOCHI_CLAUDE_BACKEND=api
ANTHROPIC_API_KEY=sk-ant-...

# All optional, with defaults
MOCHI_CLAUDE_MODEL=sonnet             # alias or full id (opus, haiku, …)
MOCHI_CLAUDE_EFFORT=low               # low | medium | high | xhigh | max
MOCHI_VISION_MODEL=opus               # model used by Vision.scanWorksheet
MOCHI_TTS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # Rachel — multilingual female
MOCHI_TTS_MODEL=eleven_turbo_v2_5
```

Without `OPENAI_API_KEY` printables fail at the OpenAI call (apps still work). Without `ELEVENLABS_API_KEY` + the two `MOCHI_PM_AGENT_ID_*` ids the voice flow fails — the type fallback still works.

## Voice + camera

- **Voice intake**: `KidPMOverlay` opens a WebSocket to one of two server-provisioned ElevenLabs Conversational AI agents — the lang chip picks `MOCHI_PM_AGENT_ID_ID` (Indonesian) or `MOCHI_PM_AGENT_ID_EN` (English) per session. The agent handles ASR + agent reasoning + TTS server-side; the browser only ships audio. The agent's `submit_requirements` client-tool call closes the loop and triggers the build. The build view itself is silent — no narration, no canned lines, just bubbles + a progress ring around the mascot.
- **Camera scan**: `KidScanOverlay` uses `getUserMedia` (rear camera if available) for a single-frame JPEG capture; the bytes go to `/api/scan/worksheet` which calls Claude vision and returns a build spec.
- **TTS in generated apps**: still wired up. The agent's SYSTEM_PROMPT documents `POST /api/voice/tts` so flashcards / read-aloud / quiz apps can speak through ElevenLabs without an API key.
- **iOS audio unlock**: `lib/audio.ts` pre-warms an `AudioContext` on the first `pointerdown` event so the PM agent's first message plays immediately on iPad — without it the gesture from tapping mic "expires" before the SDK's first audio frame arrives.
- **TV remote D-pad**: `lib/spatial-nav.ts` listens for arrow keys and focuses the visually-closest focusable element. Android TV WebView doesn't move focus on arrow keys by default; without this the kid gets stuck on whichever header button auto-focused.

Browsers gate `getUserMedia` to secure contexts — `localhost` works; plain LAN HTTP from another device's browser doesn't. The Android WebView shell bypasses that gate, which is why voice + camera work over HTTP from a TV.

## Common commands

`task --list` for the full surface. The interesting ones:

```
task dev                     # bun --hot src/index.ts
task serve                   # background server → /tmp/mochi.log
task serve:prod              # NODE_ENV=production background server
task ip                      # the LAN IP your TV / iPad needs

task https:start             # tailscale serve → https://<machine>.<tailnet>.ts.net
task https:stop              # clear the mapping

task android:run             # build + adb install + launch (TARGET=tv|phone)
task android:logcat          # filtered logcat for the Mochi app
task adb:tv / adb:phone      # connect via ADB

task apps:list               # registry contents
task apps:clean              # WIPE apps/ + SQLite (with confirm)
task apps:retitle-en         # translate every name/emoji/description to English

task firewall:allow-bun      # add bun to macOS Application Firewall (sudo)
task check                   # bunx tsc --noEmit
task test                    # bun test src/server (single file: bun test src/server/Jobs.test.ts)
```

## Where it runs

- **The Mac (or any host)** runs `bun src/index.ts` — that's the brains and the only thing with the API keys.
- **A browser** on any device on the same LAN loads `http://<host-ip>:3000`.
- **`android/`** is a thin Kotlin WebView shell so an Android TV (or phone) can host the same UI as a real installable app, with a configurable host URL stored in SharedPreferences.

`MainActivity.handleWebPermissionRequest` does the OS-level `RECORD_AUDIO` runtime grant (the WebView's `onPermissionRequest` is not enough on Android). `network_security_config.xml` permits cleartext globally because the Mochi server runs plain HTTP on the family's LAN.

## Architecture

The host is Effect-TS on `Bun.serve`. The deep tour is in [CLAUDE.md](./CLAUDE.md). Sketch:

```
src/
├── server/
│   ├── Schema.ts          effect/Schema for App, BuildEvent, Manifest
│   ├── Registry.ts        SQLite (bun:sqlite, WAL) — data/mochi.db
│   ├── ClaudeBackend.ts   single MOCHI_CLAUDE_BACKEND=cli|api toggle
│   ├── Claude.ts          build path: claude --print subprocess OR Agent SDK query()
│   ├── SonnetJson.ts      shared JSON-schema completion: CLI subprocess OR Messages API
│   ├── Build.ts           Bun.build + Tailwind plugin → bundle.js / .css
│   ├── Printable.ts       OpenAI gpt-image-2 + gpt-4o-mini metadata
│   ├── Vision.ts          worksheet photo → spec via Claude vision (CLI or API)
│   ├── Organize.ts        sonnet → category groups (after every build)
│   ├── Suggest.ts         sonnet → 5 fresh prompt ideas
│   ├── PmAgent.ts         standalone CLI to provision/update both PM agents (id + en)
│   ├── Voice.ts           ElevenLabs proxy (TTS stream + signed agent URL)
│   ├── Pricing.ts         per-million-token rate table for cost display
│   ├── Jobs.ts            PubSub fanout, SSE, manifest decode, reorganize fork
│   ├── HttpApi.ts         Bun.serve route table
│   └── Main.ts            layer wiring + BunRuntime.runMain entry
├── components/
│   ├── KidShell.tsx       the entire UI (one tree, three views)
│   ├── KidPMOverlay.tsx   conversational voice intake (create + modify)
│   ├── KidScanOverlay.tsx camera capture for worksheet → app
│   ├── Mochi.tsx          the inline-SVG mascot
│   └── AgentLog.tsx       streamed BuildEvent renderer
├── lib/                   api / speech / types / utils + audio (iOS unlock) + spatial-nav (TV D-pad)
├── icons/                 PWA icons
└── index.html, frontend.tsx, App.tsx
```

The HTTP surface:

| Method | Path                       | What                                                            |
|--------|----------------------------|-----------------------------------------------------------------|
| GET    | `/api/apps`                | list                                                            |
| POST   | `/api/apps`                | create — body `{ prompt, kind: "app" \| "printable", lang? }`   |
| GET    | `/api/apps/:id`            | one row                                                         |
| PATCH  | `/api/apps/:id`            | toggle favorite                                                 |
| DELETE | `/api/apps/:id`            | drop                                                            |
| POST   | `/api/apps/:id/modify`     | resume the claude session (apps) or regenerate (printables)     |
| GET    | `/api/apps/:id/stream`     | live SSE — text, tool, tool_result, status, done, error         |
| POST   | `/api/apps/reorganize`     | manually re-run the sonnet category step                        |
| GET    | `/api/suggestions`         | dynamic prompt ideas (sonnet, server-cached on app-id set)      |
| POST   | `/api/voice/agent-url`     | `?lang=en\|id` → signed wss:// for the matching PM agent       |
| POST   | `/api/voice/transcribe`    | ElevenLabs STT proxy (used by generated apps that record audio) |
| POST   | `/api/voice/tts`           | ElevenLabs TTS proxy (streaming MP3)                            |
| POST   | `/api/scan/worksheet`      | photographed worksheet → spec via Claude vision                 |
| GET    | `/apps/:id/*`              | static-serve the generated artifact                             |
| GET    | `/manifest.webmanifest`, `/sw.js`, `/icons/:file` | PWA                |
| GET    | `/*`                       | SPA fallback                                                    |

## Stack

- **Bun** for runtime + bundler + sqlite + http.
- **Effect-TS** for the server graph (services, layers, scoped subprocesses, streams).
- **React 19 + Tailwind v4** for the host UI; the agent generates the same.
- **Claude** for app generation, organize, suggest, vision — switchable between two backends via `MOCHI_CLAUDE_BACKEND`:
  - **CLI mode** (default): the `claude` CLI (`claude --print --output-format stream-json` for builds, `claude --print --json-schema` for structured-output one-shots). Auth via claude code login.
  - **API mode**: `@anthropic-ai/claude-agent-sdk`'s `query()` for the agentic build, plus `@anthropic-ai/sdk`'s Messages API for simple completions. Requires `ANTHROPIC_API_KEY`.
- **OpenAI** `gpt-image-2` for printables, `gpt-4o-mini` for English manifests.
- **ElevenLabs** Conversational AI ("Mochi PM" agent) for voice intake; `eleven_turbo_v2_5` streaming TTS for Mochi's voice; `scribe_v1` STT for generated apps that need it.
- **Kotlin + WebView** for the Android shell (one APK targets phone, tablet, TV).

## License

[MIT](./LICENSE) © 2026 Pahlevi Fikri Auliya.
