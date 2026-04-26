# Mochi

A family agentic app studio. A family member describes what they want — by voice or text — and Mochi spins up a real, runnable web app or a printable infographic. The library on the home screen lists everything anyone has built; tap to open, long-press to modify by talking again.

It is not a chatbot. The output is a real artifact (a React app or a PNG sized for A4) that lives on disk and can be re-opened anytime.

```
                       ┌──────────────┐
   "make me a snake    │              │      apps/<id>/index.tsx + manifest.json
    game with two   ─► │  claude -p   │ ───► bundled to bundle.js + bundle.css
    players"           │  (sonnet)    │      served at /apps/<id>/
                       └──────────────┘

                       ┌──────────────┐
   "buatkan          ─►│ gpt-image-2  │ ───► apps/<id>/print.png
    infografik           low quality          + a tiny print-CSS index.html
    sarapan sehat"     └──────────────┘      🖨 Print → A4 borderless

                       ┌──────────────┐
   sonnet sees the      │              │      categories: "Kid Games",
   registry every     ─►│  organize +  │      "Daily Routines", …
   build and orders   │  suggest    │ ───► fresh prompt ideas tailored
   the home grid      └──────────────┘      to what's already there
```

## Two output kinds

- **`kind: "app"`** — `claude -p` writes `index.tsx` + `manifest.json` into `apps/<id>/`; `Bun.build` bundles it. Modify reuses the same Claude session via `claude --resume` so each follow-up edit threads through the prior conversation.
- **`kind: "printable"`** — OpenAI `gpt-image-2` (low quality, 1024×1536 portrait) renders an infographic; the host saves `print.png` and a static A4 print-CSS shell. The 🖨 Print button in the open view triggers `window.print()` borderless.

## Quick start

```bash
# 1. Install
bun install

# 2. Drop your keys into .env
cp .env.example .env  # then edit. (Or just write .env directly.)

# 3. Start the server (HMR)
task dev               # bun --hot src/index.ts
# or:
bun --hot src/index.ts
```

Open http://localhost:3000. From any device on the same Wi-Fi: `task ip` prints the LAN address (e.g. `http://192.168.1.42:3000`).

For HTTPS-only browsers (iPad Safari needs HTTPS for the microphone), `task https:start` exposes the same port over a real Let's Encrypt cert at `https://<machine>.<tailnet>.ts.net` via Tailscale.

## Required env

Put these in `.env` — Bun auto-loads them.

```bash
# Required for printables and the dynamic-title gpt-4o-mini call
OPENAI_API_KEY=sk-...

# Required for the voice flow (STT + TTS)
ELEVENLABS_API_KEY=...

# Optional, all have defaults
MOCHI_CLAUDE_MODEL=sonnet                   # alias or full model id (opus, haiku, …)
MOCHI_CLAUDE_EFFORT=low                     # low | medium | high | xhigh | max
MOCHI_TTS_VOICE_ID=21m00Tcm4TlvDq8ikWAM     # Rachel — multilingual female
MOCHI_TTS_MODEL=eleven_turbo_v2_5
MOCHI_STT_MODEL=scribe_v1
```

Without `OPENAI_API_KEY` printables fail at the OpenAI call (apps still work). Without `ELEVENLABS_API_KEY` the mic and Mochi's voice silently no-op.

Claude itself uses your Claude Code keychain OAuth — nothing extra to set.

## Voice

- **STT**: `MediaRecorder` + an `AnalyserNode`-based RMS VAD captures one utterance, auto-stops after 2 s of silence, and POSTs to `/api/voice/transcribe` which proxies to ElevenLabs Scribe.
- **TTS**: `/api/voice/tts` proxies to ElevenLabs `eleven_turbo_v2_5`. The mp3 plays through a single shared `<audio>` so consecutive calls cancel the prior utterance.

The proxy keeps the API key server-side. Browser only ever talks to Mochi.

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
task test                    # bun test src/server
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
│   ├── Schema.ts         effect/Schema for App, BuildEvent, Manifest
│   ├── Registry.ts       SQLite (bun:sqlite, WAL) — data/mochi.db
│   ├── Claude.ts         claude --print stream-json subprocess
│   ├── Build.ts          Bun.build + Tailwind plugin → bundle.js / .css
│   ├── Printable.ts      OpenAI gpt-image-2 + gpt-4o-mini metadata
│   ├── Organize.ts       sonnet → category groups (after every build)
│   ├── Suggest.ts        sonnet → 5 fresh prompt ideas
│   ├── Voice.ts          ElevenLabs STT + TTS proxy
│   ├── Pricing.ts        per-million-token rate table for cost display
│   ├── Jobs.ts           PubSub fanout, SSE, manifest decode, reorganize fork
│   ├── HttpApi.ts        Bun.serve route table
│   └── Main.ts           layer wiring + BunRuntime.runMain entry
├── components/
│   ├── KidShell.tsx      the entire UI (one tree, three views)
│   ├── Mochi.tsx         the inline-SVG mascot
│   └── AgentLog.tsx      streamed BuildEvent renderer
├── lib/                  api / speech / tts / types / utils
├── icons/                PWA icons
└── index.html, frontend.tsx, App.tsx
```

The HTTP surface:

| Method | Path                       | What                                                           |
|--------|----------------------------|----------------------------------------------------------------|
| GET    | `/api/apps`                | list                                                           |
| POST   | `/api/apps`                | create — body `{ prompt, kind: "app" \| "printable" }`         |
| GET    | `/api/apps/:id`            | one row                                                        |
| PATCH  | `/api/apps/:id`            | toggle favorite                                                |
| DELETE | `/api/apps/:id`            | drop                                                           |
| POST   | `/api/apps/:id/modify`     | resume the claude session (apps) or regenerate (printables)    |
| GET    | `/api/apps/:id/stream`     | live SSE — text, tool, tool_result, status, done, error, raw   |
| POST   | `/api/apps/reorganize`     | manually re-run the sonnet category step                       |
| GET    | `/api/suggestions`         | dynamic prompt ideas (sonnet, server-cached on app-id set)     |
| POST   | `/api/voice/transcribe`    | ElevenLabs STT proxy                                           |
| POST   | `/api/voice/tts`           | ElevenLabs TTS proxy                                           |
| GET    | `/apps/:id/*`              | static-serve the generated artifact                            |
| GET    | `/manifest.webmanifest`, `/sw.js`, `/icons/:file` | PWA               |
| GET    | `/*`                       | SPA fallback                                                   |

## Stack

- **Bun** for runtime + bundler + sqlite + http.
- **Effect-TS** for the server graph (services, layers, scoped subprocesses, streams).
- **React 19 + Tailwind v4** for the host UI; the agent generates the same.
- **Claude Code CLI** (`claude -p`) for app generation, organize, and suggestions.
- **OpenAI** `gpt-image-2` for printables, `gpt-4o-mini` for English manifests.
- **ElevenLabs** `scribe_v1` for STT, `eleven_turbo_v2_5` for TTS.
- **Kotlin + WebView** for the Android shell (one APK targets phone, tablet, TV).

## License

Personal project, no license declared yet.
