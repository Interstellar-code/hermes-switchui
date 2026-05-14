import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

function getMigrationVersion(filename: string): number {
  const match = filename.match(/^(\d+)_/);
  if (!match) throw new Error(`Migration filename must start with numeric prefix: ${filename}`);
  return parseInt(match[1], 10);
}

export function runMigrations(db: Database.Database): void {
  // Ensure schema_meta exists to read current version.
  // On a fresh DB it won't exist — that's handled by running 001_init.sql which creates it.
  let currentVersion = 0;

  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")
    .get();

  if (tableExists) {
    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key='schema_version'")
      .get() as { value: string } | undefined;

    if (!row) {
      throw new Error(
        "schema_meta table exists but schema_version row is missing. DB may be corrupted."
      );
    }
    currentVersion = parseInt(row.value, 10);
    if (isNaN(currentVersion)) {
      throw new Error(`Unexpected schema_version value: '${row.value}'. Expected a numeric string.`);
    }
  }

  // Collect migration files sorted numerically.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => getMigrationVersion(a) - getMigrationVersion(b));

  for (const file of files) {
    const version = getMigrationVersion(file);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");

    db.transaction(() => {
      db.exec(sql);
      // Update schema_version after applying the migration.
      // schema_meta is created by 001_init.sql itself with INSERT statements,
      // so for subsequent migrations we upsert.
      db.prepare(
        "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      ).run(String(version));
    })();
  }
}
