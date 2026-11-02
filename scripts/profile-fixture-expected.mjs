// Writes src-tauri/tests/fixtures/<profile folder>/expected.json from the generated files themselves
// (scripts/profile-fixture.md): `settings` = the parsed settings.json, `kv` = every row of state.db's kv table
// read back with Node's built-in sqlite, sorted by key. Nothing in it is typed by hand.
// Usage: node scripts/profile-fixture-expected.mjs src-tauri/tests/fixtures/profile-v0.1.5
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/profile-fixture-expected.mjs <fixture folder>");
  process.exit(2);
}
const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
const db = new DatabaseSync(join(dir, "state.db"), { readOnly: true });
const kv = Object.fromEntries(db.prepare("SELECT key, value FROM kv ORDER BY key").all().map((r) => [r.key, r.value]));
db.close();
for (const ext of ["-wal", "-shm"]) rmSync(join(dir, "state.db" + ext), { force: true }); // a read of a WAL-mode database can leave these behind
const note = "Snapshot of what today's code must read from this release's profile. settings = settings.json as written; kv = the kv table sorted by key; both read from the generated files by scripts/profile-fixture-expected.mjs. See scripts/profile-fixture.md.";
writeFileSync(join(dir, "expected.json"), JSON.stringify({ _note: note, settings, kv }, null, 2) + "\n");
console.log(`wrote ${join(dir, "expected.json")}: ${Object.keys(settings).length} settings, ${Object.keys(kv).length} kv rows`);
