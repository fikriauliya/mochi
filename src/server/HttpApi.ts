import { Path } from "@effect/platform";
import { Effect, ParseResult, Runtime, Schema as S, Stream } from "effect";
import indexHtml from "../index.html";
import { BuildService } from "./Build";
import { ClaudeService } from "./Claude";
import { JobsService } from "./Jobs";
import { OrganizeService } from "./Organize";
import { PrintableService } from "./Printable";
import { RegistryService } from "./Registry";
import { type App, CreateAppRequest, PatchAppRequest } from "./Schema";
import { SuggestService } from "./Suggest";
import { VoiceService } from "./Voice";

/** Services consumed by the HTTP route handlers. */
export type MochiServices =
  | RegistryService
  | JobsService
  | ClaudeService
  | BuildService
  | PrintableService
  | OrganizeService
  | SuggestService
  | VoiceService
  | Path.Path;

const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
  connection: "keep-alive",
};

const MANIFEST = {
  name: "Mochi — Family App Studio",
  short_name: "Mochi",
  description: "Ask Mochi to make you an app — the family kitchen for tiny custom apps.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#fbf1e1",
  theme_color: "#fbf1e1",
  lang: "en",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  ],
};

// Tiny no-op service worker. The only reason it exists is to satisfy
// Chrome's PWA-install heuristic — Mochi is online-only by design (the
// server is the brain), so caching would just serve stale UI.
const SW_SOURCE = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
`;

const decodeCreate = S.decodeUnknown(CreateAppRequest);
const decodePatch = S.decodeUnknown(PatchAppRequest);

/**
 * Suggestions cache — keyed on the sorted app-id set so we re-invoke
 * sonnet only when the registry changes (add / delete). Renames don't
 * invalidate; the suggestions still feel fresh because they're scoped
 * to the user's *kinds* of apps, not specific titles. In-memory only;
 * a server restart regenerates on first request.
 */
let suggestCache: { key: string; suggestions: ReadonlyArray<string> } | null =
  null;

const appsKey = (apps: ReadonlyArray<App>): string =>
  apps
    .map((a) => a.id)
    .sort()
    .join(",");

function shortHex(n = 4): string {
  return [...crypto.getRandomValues(new Uint8Array(n))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

function newAppId(prompt: string): string {
  const stem = slug(prompt) || "app";
  return `${stem}-${shortHex(2)}`;
}

const newSessionId = (): string => crypto.randomUUID();

const errorJson = (status: number, message: string) =>
  Response.json({ error: message }, { status });

const okJson = (body: unknown, status = 200) =>
  Response.json(body, { status });

/**
 * Wraps an Effect that produces a `Response`, catching all known typed errors
 * and surfacing them as 4xx/5xx JSON responses. The returned Effect always
 * succeeds, so the runtime caller doesn't need a try/catch.
 */
const handle = <A>(
  effect: Effect.Effect<Response, unknown, A>,
): Effect.Effect<Response, never, A> =>
  effect.pipe(
    Effect.catchAll((err) => {
      if (typeof err === "object" && err !== null && "_tag" in err) {
        const tag = (err as { _tag: string })._tag;
        if (tag === "AppNotFound") return Effect.succeed(errorJson(404, "app not found"));
        if (tag === "JobAlreadyRunning")
          return Effect.succeed(errorJson(409, "a build is already running for this app"));
      }
      if (ParseResult.isParseError(err)) {
        return Effect.succeed(errorJson(400, ParseResult.TreeFormatter.formatErrorSync(err)));
      }
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      return Effect.succeed(errorJson(500, message));
    }),
  );

/** Build the route table for `Bun.serve`, closing over an Effect runtime. */
export function makeRoutes(runtime: Runtime.Runtime<MochiServices>) {
  const runP = Runtime.runPromise(runtime);

  return {
    // ---- LIST APPS ----
    "/api/apps": {
      GET: () =>
        runP(
          handle(
            Effect.gen(function* () {
              const reg = yield* RegistryService;
              const apps = yield* reg.list;
              return okJson(apps);
            }),
          ),
        ),

      // ---- CREATE APP ----
      POST: (req: Request) =>
        runP(
          handle(
            Effect.gen(function* () {
              const body = yield* Effect.tryPromise({
                try: () => req.json(),
                catch: () => new Error("invalid JSON body"),
              });
              const parsed = yield* decodeCreate(body);
              const kind = parsed.kind ?? "app";
              const id = newAppId(parsed.prompt);
              const sessionId = newSessionId();
              const now = Date.now();
              const app: App = {
                id,
                sessionId,
                kind,
                name: parsed.prompt.slice(0, 60),
                emoji: kind === "printable" ? "🖨" : "🍡",
                description: parsed.prompt,
                prompt: parsed.prompt,
                status: "building",
                favorite: false,
                category: "",
                position: 0,
                createdAt: now,
                updatedAt: now,
              };
              const reg = yield* RegistryService;
              yield* reg.upsert(app);
              const jobs = yield* JobsService;
              yield* jobs.start(id, "create", parsed.prompt);
              return okJson(app, 201);
            }),
          ),
        ),
    },

    // ---- MANUAL REORGANIZE ----
    // Triggers the same sonnet-driven categorization that runs after a
    // build. Useful for legacy registries (where every row was created
    // before organize existed) and for re-running on demand.
    "/api/apps/reorganize": {
      POST: () =>
        runP(
          handle(
            Effect.gen(function* () {
              const jobs = yield* JobsService;
              yield* jobs.reorganize();
              suggestCache = null;
              const reg = yield* RegistryService;
              const apps = yield* reg.list;
              return okJson({ count: apps.length });
            }),
          ),
        ),
    },

    // ---- ONE APP ----
    "/api/apps/:id": {
      GET: (req: Request & { params: { id: string } }) =>
        runP(
          handle(
            Effect.gen(function* () {
              const reg = yield* RegistryService;
              const app = yield* reg.get(req.params.id);
              return okJson(app);
            }),
          ),
        ),

      // ---- PATCH (favorite toggle today; future user-settable fields go here) ----
      PATCH: (req: Request & { params: { id: string } }) =>
        runP(
          handle(
            Effect.gen(function* () {
              const body = yield* Effect.tryPromise({
                try: () => req.json(),
                catch: () => new Error("invalid JSON body"),
              });
              const parsed = yield* decodePatch(body);
              const reg = yield* RegistryService;
              const updated = yield* reg.patch(
                req.params.id,
                parsed.favorite !== undefined
                  ? { favorite: parsed.favorite }
                  : {},
              );
              return okJson(updated);
            }),
          ),
        ),

      DELETE: (req: Request & { params: { id: string } }) =>
        runP(
          handle(
            Effect.gen(function* () {
              const reg = yield* RegistryService;
              yield* reg.remove(req.params.id);
              return new Response(null, { status: 204 });
            }),
          ),
        ),
    },

    // ---- BUILD/MODIFY STREAM (SSE) ----
    "/api/apps/:id/stream": (req: Request & { params: { id: string } }) => {
      const id = req.params.id;
      const events = Stream.unwrap(
        Effect.flatMap(JobsService, (j) => Effect.succeed(j.subscribe(id))),
      );
      const lines = events.pipe(
        Stream.map(
          (ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`,
        ),
        Stream.merge(
          Stream.tick("15 seconds").pipe(Stream.map(() => ":\n\n")),
          { haltStrategy: "left" },
        ),
      );
      const sseBytes = Stream.concat(
        Stream.succeed(": connected\n\n") as Stream.Stream<string>,
        lines,
      ).pipe(Stream.encodeText);
      return new Response(
        Stream.toReadableStreamRuntime(sseBytes, runtime),
        { status: 200, headers: SSE_HEADERS },
      );
    },

    // ---- MODIFY ----
    "/api/apps/:id/modify": {
      POST: (req: Request & { params: { id: string } }) =>
        runP(
          handle(
            Effect.gen(function* () {
              const body = yield* Effect.tryPromise({
                try: () => req.json(),
                catch: () => new Error("invalid JSON body"),
              });
              const parsed = yield* decodeCreate(body);
              const reg = yield* RegistryService;
              yield* reg.get(req.params.id); // 404 fast if missing
              const jobs = yield* JobsService;
              yield* jobs.start(req.params.id, "modify", parsed.prompt);
              // jobs.start has synchronously flipped status="building"; refetch
              // so the response reflects that — otherwise the client's local
              // copy stays "ready" and the build view auto-redirects past us.
              const app = yield* reg.get(req.params.id);
              return okJson(app, 202);
            }),
          ),
        ),
    },

    // ---- STATIC: GENERATED APP FILES ----
    "/apps/:id": (req: Request & { params: { id: string } }) =>
      serveAppFile(req.params.id, "index.html"),
    "/apps/:id/": (req: Request & { params: { id: string } }) =>
      serveAppFile(req.params.id, "index.html"),
    // Bun's wildcard matches multi-segment paths but doesn't populate
    // params["*"], so we recover the rest from the URL.
    "/apps/:id/*": (req: Request & { params: { id: string } }) => {
      const url = new URL(req.url);
      const prefix = `/apps/${req.params.id}/`;
      const rest = url.pathname.startsWith(prefix)
        ? url.pathname.slice(prefix.length)
        : "index.html";
      return serveAppFile(req.params.id, rest || "index.html");
    },

    // ---- SUGGESTIONS: cached sonnet ideas based on the registry ----
    "/api/suggestions": {
      GET: () =>
        runP(
          handle(
            Effect.gen(function* () {
              const reg = yield* RegistryService;
              const apps = yield* reg.list;
              const key = appsKey(apps);
              if (suggestCache && suggestCache.key === key) {
                return okJson({ suggestions: suggestCache.suggestions });
              }
              const suggester = yield* SuggestService;
              const suggestions = yield* suggester.suggest(
                apps.map((a) => ({
                  name: a.name,
                  emoji: a.emoji,
                  description: a.description,
                  kind: a.kind,
                })),
              );
              suggestCache = { key, suggestions };
              return okJson({ suggestions });
            }),
          ),
        ),
    },

    // ---- VOICE: ElevenLabs proxy (key stays server-side) ----
    "/api/voice/transcribe": {
      POST: (req: Request) =>
        runP(
          handle(
            Effect.gen(function* () {
              const buf = yield* Effect.tryPromise({
                try: () => req.arrayBuffer(),
                catch: () => new Error("invalid audio body"),
              });
              const audio = new Uint8Array(buf);
              if (audio.byteLength === 0) {
                return errorJson(400, "empty audio");
              }
              const mimeType =
                req.headers.get("content-type") ?? "audio/webm";
              const lang =
                new URL(req.url).searchParams.get("lang") ?? undefined;
              const voice = yield* VoiceService;
              const text = yield* voice.transcribe(audio, mimeType, lang);
              return okJson({ text });
            }),
          ),
        ),
    },

    "/api/voice/tts": {
      POST: (req: Request) =>
        runP(
          handle(
            Effect.gen(function* () {
              const body = yield* Effect.tryPromise({
                try: () => req.json() as Promise<{ text?: string }>,
                catch: () => new Error("invalid JSON body"),
              });
              const text = (body.text ?? "").trim();
              if (!text) return errorJson(400, "text required");
              if (text.length > 1000)
                return errorJson(400, "text too long (max 1000 chars)");
              const voice = yield* VoiceService;
              const audio = yield* voice.synthesize(text);
              return new Response(audio, {
                headers: {
                  "content-type": "audio/mpeg",
                  "cache-control": "private, no-store",
                },
              });
            }),
          ),
        ),
    },

    // ---- PWA: manifest, service worker, icons ----
    "/manifest.webmanifest": () =>
      new Response(JSON.stringify(MANIFEST), {
        headers: {
          "content-type": "application/manifest+json; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      }),

    "/sw.js": () =>
      new Response(SW_SOURCE, {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          // Browsers cap SW caching at 24h regardless, but say so explicitly.
          "cache-control": "no-cache",
          // Required to allow registering a SW served at the root scope.
          "service-worker-allowed": "/",
        },
      }),

    "/icons/:file": (req: Request & { params: { file: string } }) =>
      serveIcon(req.params.file),

    // ---- SPA FALLBACK ----
    "/*": indexHtml,
  };
}

const ICON_TYPES: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
};

async function serveIcon(file: string): Promise<Response> {
  if (file.includes("/") || file.includes("..")) {
    return new Response("forbidden", { status: 403 });
  }
  const ext = file.split(".").pop() ?? "";
  const type = ICON_TYPES[ext];
  if (!type) return new Response("not found", { status: 404 });
  const path = `src/icons/${file}`;
  const f = Bun.file(path);
  if (!(await f.exists())) return new Response("not found", { status: 404 });
  return new Response(f, {
    headers: { "content-type": type, "cache-control": "public, max-age=86400" },
  });
}

async function serveAppFile(id: string, rest: string): Promise<Response> {
  if (id.includes("/") || id.includes("..") || rest.includes("..")) {
    return new Response("forbidden", { status: 403 });
  }
  const file = Bun.file(`apps/${id}/${rest}`);
  if (!(await file.exists())) {
    return new Response("not found", { status: 404 });
  }
  return new Response(file);
}
