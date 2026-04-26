import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { FileSystem } from "@effect/platform";
import { Context, Data, Effect, Layer } from "effect";
import { App, type AppKind, type AppStatus } from "./Schema";

export class RegistryError extends Data.TaggedError("RegistryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AppNotFound extends Data.TaggedError("AppNotFound")<{
  readonly id: string;
}> {}

export class RegistryService extends Context.Tag("RegistryService")<
  RegistryService,
  {
    readonly list: Effect.Effect<ReadonlyArray<App>, RegistryError>;
    readonly get: (id: string) => Effect.Effect<App, AppNotFound | RegistryError>;
    readonly upsert: (app: App) => Effect.Effect<App, RegistryError>;
    readonly patch: (
      id: string,
      patch: Partial<App>,
    ) => Effect.Effect<App, AppNotFound | RegistryError>;
    readonly remove: (id: string) => Effect.Effect<void, RegistryError>;
  }
>() {}

const DEFAULT_DB_PATH = "data/mochi.db";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS apps (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'app',
    name        TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    description TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    status      TEXT NOT NULL,
    favorite    INTEGER NOT NULL DEFAULT 0,
    category    TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    last_error  TEXT
  );
  CREATE INDEX IF NOT EXISTS apps_created_at ON apps(created_at DESC);
`;

/**
 * Add columns to pre-existing databases. SQLite has no `IF NOT EXISTS` for
 * ADD COLUMN, so we inspect `pragma_table_info` first. Each entry is
 * idempotent — re-running on a fresh DB is a no-op.
 */
function migrateColumns(db: Database): void {
  const cols = new Set(
    db
      .prepare<{ name: string }, []>("SELECT name FROM pragma_table_info('apps')")
      .all()
      .map((c) => c.name),
  );
  const additions: Array<[string, string]> = [
    ["kind", "TEXT NOT NULL DEFAULT 'app'"],
    ["favorite", "INTEGER NOT NULL DEFAULT 0"],
    ["position", "INTEGER NOT NULL DEFAULT 0"],
    ["category", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, defn] of additions) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE apps ADD COLUMN ${name} ${defn}`);
    }
  }
}

type Row = {
  id: string;
  session_id: string;
  kind: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
  status: string;
  favorite: number;
  category: string;
  position: number;
  created_at: number;
  updated_at: number;
  last_error: string | null;
};

const rowToApp = (row: Row): App => ({
  id: row.id,
  sessionId: row.session_id,
  kind: (row.kind as AppKind) || "app",
  name: row.name,
  emoji: row.emoji,
  description: row.description,
  prompt: row.prompt,
  status: row.status as AppStatus,
  favorite: row.favorite === 1,
  category: row.category ?? "",
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.last_error != null ? { lastError: row.last_error } : {}),
});

const wrapDb = <A>(work: () => A) =>
  Effect.try({
    try: work,
    catch: (cause) =>
      new RegistryError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/**
 * Build a registry layer backed by a SQLite database at `dbPath`.
 * Production wires {@link RegistryLive} (data/mochi.db); tests wire a
 * fresh temp path so they're hermetic.
 */
export const makeRegistryLive = (dbPath: string) => Layer.scoped(
  RegistryService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = dirname(dbPath);
    if (dir && dir !== ".") {
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore);
    }

    // Open DB. SQLite handles concurrent reads/writes itself; we don't need
    // a Semaphore or in-memory cache. WAL mode lets readers and writers not
    // block each other.
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const d = new Database(dbPath, { create: true });
        d.exec("PRAGMA journal_mode = WAL");
        d.exec("PRAGMA synchronous = NORMAL");
        d.exec("PRAGMA foreign_keys = ON");
        d.exec(SCHEMA);
        migrateColumns(d);
        return d;
      }),
      (d) => Effect.sync(() => d.close()),
    );

    const listStmt = db.prepare<Row, []>(
      "SELECT * FROM apps ORDER BY created_at DESC",
    );
    const getStmt = db.prepare<Row, [string]>(
      "SELECT * FROM apps WHERE id = ?",
    );
    const upsertStmt = db.prepare<
      unknown,
      [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        string,
        number,
        number,
        number,
        string | null,
      ]
    >(`
      INSERT INTO apps (
        id, session_id, kind, name, emoji, description,
        prompt, status, favorite, category, position, created_at, updated_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        session_id  = excluded.session_id,
        kind        = excluded.kind,
        name        = excluded.name,
        emoji       = excluded.emoji,
        description = excluded.description,
        prompt      = excluded.prompt,
        status      = excluded.status,
        favorite    = excluded.favorite,
        category    = excluded.category,
        position    = excluded.position,
        updated_at  = excluded.updated_at,
        last_error  = excluded.last_error
    `);
    const removeStmt = db.prepare<unknown, [string]>(
      "DELETE FROM apps WHERE id = ?",
    );

    const persist = (app: App) =>
      wrapDb(() =>
        upsertStmt.run(
          app.id,
          app.sessionId,
          app.kind,
          app.name,
          app.emoji,
          app.description,
          app.prompt,
          app.status,
          app.favorite ? 1 : 0,
          app.category,
          app.position,
          app.createdAt,
          app.updatedAt,
          app.lastError ?? null,
        ),
      );

    return RegistryService.of({
      list: wrapDb(() => listStmt.all().map(rowToApp)),

      get: (id) =>
        Effect.gen(function* () {
          const row = yield* wrapDb(() => getStmt.get(id));
          if (!row) return yield* Effect.fail(new AppNotFound({ id }));
          return rowToApp(row);
        }),

      upsert: (app) =>
        Effect.gen(function* () {
          yield* persist(app);
          return app;
        }),

      patch: (id, patch) =>
        Effect.gen(function* () {
          const row = yield* wrapDb(() => getStmt.get(id));
          if (!row) return yield* Effect.fail(new AppNotFound({ id }));
          const current = rowToApp(row);
          const merged: App = {
            ...current,
            ...patch,
            updatedAt: Date.now(),
          };
          yield* persist(merged);
          return merged;
        }),

      remove: (id) => wrapDb(() => removeStmt.run(id)).pipe(Effect.asVoid),
    });
  }),
);

export const RegistryLive = makeRegistryLive(DEFAULT_DB_PATH);
