# Mochi

A family agentic app studio. A family member talks to **Mochi PM** (a voice agent) about what they want — or photographs a printed worksheet — and Mochi spins up a real, runnable web app or a printable infographic. The library on the home screen lists everything anyone has built; tap to open, long-press to modify by talking again. Mochi narrates as it builds.

It is not a chatbot. The output is a real artifact (a React app or a PNG sized for A4) that lives on disk and can be re-opened anytime.

```
                        ┌──────────────┐
   "make me a            │              │      apps/<id>/index.tsx + manifest.json
    snake game"      ──► │  claude -p   │ ───► bundled to bundle.js + bundle.css
   (via PM agent)        │  (sonnet)    │      served at /apps/<id>/
                         └──────────────┘
                                │
                                │  while building, sonnet narrates
                                ▼  one short kid line every ~8s
                              "now I'm picking warm colors!"
                                │
                                ▼  spoken via ElevenLabs TTS

                         ┌──────────────┐
   📷  photo of           │              │     vision describes the page,
       printed         ──►│ claude opus  │ ──► hands a complete spec to the
       worksheet          │   vision     │     same /api/apps build pipeline
                         └──────────────┘

                         ┌──────────────┐
   "buatkan            ──►│ gpt-image-2  │ ──► apps/<id>/print.png
    infografik             low quality          + a tiny print-CSS index.html
    sarapan sehat"       └──────────────┘     🖨 Print → A4 borderless
```

## Three ways to start a build

- **🎙 Tap & talk** — opens the **Mochi PM** voice agent (ElevenLabs Conversational AI). It asks 2–4 short kid-friendly questions, then submits a complete English spec to the build pipeline.
- **🖨 Make a printable** — same voice agent, but the agent knows it's gathering requirements for a printable infographic; the spec ends up at `gpt-image-2`.
- **📷 Scan a worksheet** — the device camera photographs a printed maths sheet / coloring page / maze; **Claude Opus** (vision) reverse-engineers it into an interactive web-app spec, then the normal build runs.

Plus a text fallback for adults.

## Two output kinds

- **`kind: "app"`** — `claude` (CLI by default, or Anthropic Agent SDK with `MOCHI_CLAUDE_BACKEND=api`) writes `index.tsx` + `manifest.json` into `apps/<id>/`; `Bun.build` bundles it. Modify reuses the same Claude session via `--resume` so each follow-up edit threads through the prior conversation.
- **`kind: "printable"`** — OpenAI `gpt-image-2` (low quality, 1024×1536 portrait) renders an infographic; the host saves `print.png` and a static A4 print-CSS shell. The 🖨 Print button in the open view triggers `window.print()` borderless.

## Quick start

```bash
# 1. Install
bun install

# 2. Set up your .env (see "Required env" below)

# 3. Provision the PM agent in your ElevenLabs workspace (one-time)
bun src/server/PmAgent.ts
# → prints MOCHI_PM_AGENT_ID=agent_…  (paste into .env)

# 4. Start the server (HMR)
task dev               # bun --hot src/index.ts
```

Open http://localhost:3000. From any device on the same Wi-Fi: `task ip` prints the LAN address.

For HTTPS-only browsers (iPad Safari needs HTTPS for the microphone + camera), `task https:start` exposes the same port via Tailscale at `https://<machine>.<tailnet>.ts.net`.

## Required env

Put these in `.env` — Bun auto-loads them.

```bash
# ElevenLabs powers the PM agent + Mochi's TTS narration
ELEVENLABS_API_KEY=...
MOCHI_PM_AGENT_ID=agent_...           # printed by `bun src/server/PmAgent.ts`

# OpenAI powers printables + the dynamic-title gpt-4o-mini call
OPENAI_API_KEY=sk-...

# Required only when MOCHI_CLAUDE_BACKEND=api
ANTHROPIC_API_KEY=sk-ant-...

# All optional, with defaults
MOCHI_CLAUDE_BACKEND=cli              # cli (default) | api
MOCHI_CLAUDE_MODEL=sonnet             # alias or full id (opus, haiku, …)
MOCHI_CLAUDE_EFFORT=low               # low | medium | high | xhigh | max
MOCHI_VISION_MODEL=opus               # model used by Vision.scanWorksheet
MOCHI_TTS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # Rachel — multilingual female
MOCHI_TTS_MODEL=eleven_turbo_v2_5
```

`MOCHI_CLAUDE_BACKEND` is the comparison switch:
- **`cli`** routes every Claude call (build, narrator, organize, suggest, vision) through the local `claude` CLI. Auth comes from your claude code login — no API key needed.
- **`api`** swaps the build path to `@anthropic-ai/claude-agent-sdk` and the simple completions to the Anthropic Messages API. Requires `ANTHROPIC_API_KEY`.

Without `OPENAI_API_KEY` printables fail at the OpenAI call (apps still work). Without `ELEVENLABS_API_KEY` + `MOCHI_PM_AGENT_ID` the voice flow fails — the type fallback still works.

## Voice + camera

- **Voice intake**: `KidPMOverlay` opens a WebSocket to a server-provisioned ElevenLabs Conversational AI agent ("Mochi PM"). The agent handles ASR + agent reasoning + TTS server-side; the browser only ships audio. The agent's `submit_requirements` client-tool call closes the loop and triggers the build.
- **Mochi's voice during builds**: a server-side `Narrator` watches the build's event stream and asks Sonnet for one short kid-friendly first-person line every ~8s. Each line is published as a `narration` BuildEvent and played in the browser through ElevenLabs TTS over a streaming `MediaSource`.
- **Camera scan**: `KidScanOverlay` uses `getUserMedia` (rear camera if available) for a single-frame JPEG capture; the bytes go to `/api/scan/worksheet` which calls Claude vision and returns a build spec.

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
│   ├── Narrator.ts        sonnet → one short kid-friendly line per ~8s during a build
│   ├── PmAgent.ts         standalone CLI to provision/update the ElevenLabs PM agent
│   ├── Voice.ts           ElevenLabs proxy (TTS stream + signed agent URL)
│   ├── Pricing.ts         per-million-token rate table for cost display
│   ├── Jobs.ts            PubSub fanout, SSE, manifest decode, narrator + reorganize forks
│   ├── HttpApi.ts         Bun.serve route table
│   └── Main.ts            layer wiring + BunRuntime.runMain entry
├── components/
│   ├── KidShell.tsx       the entire UI (one tree, three views)
│   ├── KidPMOverlay.tsx   conversational voice intake (create + modify)
│   ├── KidScanOverlay.tsx camera capture for worksheet → app
│   ├── Mochi.tsx          the inline-SVG mascot
│   └── AgentLog.tsx       streamed BuildEvent renderer (incl. narration lines)
├── lib/                   api / speech / tts / types / utils
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
| GET    | `/api/apps/:id/stream`     | live SSE — text, tool, tool_result, status, narration, done, error, raw |
| POST   | `/api/apps/reorganize`     | manually re-run the sonnet category step                        |
| GET    | `/api/suggestions`         | dynamic prompt ideas (sonnet, server-cached on app-id set)      |
| POST   | `/api/voice/agent-url`     | signed wss:// for the kid-PM Conversational AI agent            |
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
- **Claude** for app generation, narration, organize, suggest, vision — via the Claude Code CLI by default, or the `@anthropic-ai/claude-agent-sdk` + `@anthropic-ai/sdk` Messages API with `MOCHI_CLAUDE_BACKEND=api`.
- **OpenAI** `gpt-image-2` for printables, `gpt-4o-mini` for English manifests.
- **ElevenLabs** Conversational AI ("Mochi PM" agent) for voice intake; `eleven_turbo_v2_5` streaming TTS for Mochi's voice; `scribe_v1` STT for generated apps that need it.
- **Kotlin + WebView** for the Android shell (one APK targets phone, tablet, TV).

## License

Personal project, no license declared yet.
