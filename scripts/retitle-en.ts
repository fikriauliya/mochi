/**
 * One-shot: walk every row in data/mochi.db and replace `name`, `emoji`,
 * `description` with English equivalents derived from the original `prompt`
 * via gpt-4o-mini. Idempotent — re-running on already-English titles just
 * regenerates similar text.
 *
 *   bun scripts/retitle-en.ts            # all rows
 *   bun scripts/retitle-en.ts --dry-run  # print plans, don't write
 *   bun scripts/retitle-en.ts --only=ID  # one specific app id
 *
 * Cost: ~$0.0001 per app on gpt-4o-mini. Safe to run on a registry of
 * tens of apps without thinking about it.
 *
 * SQLite WAL mode lets this script write while the server is also reading,
 * but to be safe we open a fresh connection rather than going through the
 * server's HTTP API (no PATCH endpoint exists). The OpenAI call itself is
 * `fetchEnglishMetadata` from the printable service, so the script and the
 * server share one implementation.
 */
import { Database } from "bun:sqlite";
import { fetchEnglishMetadata } from "../src/server/Printable";

const DB_PATH = "data/mochi.db";

type Row = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
};

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const onlyId = onlyArg ? onlyArg.slice("--only=".length) : null;

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set. Add it to .env first.");
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  const rows = onlyId
    ? db
        .prepare<Row, [string]>(
          "SELECT id, name, emoji, description, prompt FROM apps WHERE id = ?",
        )
        .all(onlyId)
    : db
        .prepare<Row, []>(
          "SELECT id, name, emoji, description, prompt FROM apps ORDER BY created_at DESC",
        )
        .all();

  if (rows.length === 0) {
    console.log("No apps found.");
    return;
  }

  const update = db.prepare<unknown, [string, string, string, number, string]>(
    "UPDATE apps SET name = ?, emoji = ?, description = ?, updated_at = ? WHERE id = ?",
  );

  console.log(`Retitling ${rows.length} app${rows.length === 1 ? "" : "s"}…`);
  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    process.stdout.write(`  ${row.id}: ${row.name} → `);
    try {
      const meta = await fetchEnglishMetadata(apiKey, row.prompt);
      if (dryRun) {
        console.log(`${meta.emoji} ${meta.name}  (dry-run)`);
      } else {
        update.run(meta.name, meta.emoji, meta.description, Date.now(), row.id);
        console.log(`${meta.emoji} ${meta.name}`);
      }
      ok += 1;
    } catch (e) {
      console.log(`fail (${e instanceof Error ? e.message : String(e)})`);
      fail += 1;
    }
  }
  db.close();
  console.log(`done — ${ok} updated, ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
