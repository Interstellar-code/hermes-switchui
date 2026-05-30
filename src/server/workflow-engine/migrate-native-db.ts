/**
 * migrate-native-db.ts — one-shot importer from the old native SQLite DB
 * (~/.hermes/switchui-workflows.db) into the plugin DB.
 *
 * Evidence from git history:
 *   - Native DB path: join(homedir(), '.hermes', 'switchui-workflows.db')
 *     (overridable via HERMES_WORKFLOW_DB_PATH or SWITCHUI_WORKFLOW_DB_PATH)
 *   - Schema (001_init.sql @ 97ebfc7c): workflow_definitions table with
 *     columns id, name, description, source, scope_path, yaml, checksum,
 *     version, tags, created_at, updated_at
 *   - Only source IN ('user','project') rows are worth migrating;
 *     'bundled' rows are re-seeded by the plugin on boot.
 *   - Plugin upsert: PluginClient.upsertDefinition(yaml, sourcePath?)
 *     → POST /api/plugins/workflow-engine/definitions { yaml, source_path }
 *     Plugin derives id + name from YAML content; 409/4xx = collision → skip.
 *
 * Idempotency guard: a sibling marker file `<db>.migrated-<unixts>` is written
 * after a successful run. If ANY .migrated-* sibling exists, this is a no-op.
 * The original DB is renamed to `<db>.migrated-<unixts>` (never deleted).
 *
 * Wiring suggestion: call migrateNativeWorkflowDbOnce() once at server boot,
 * e.g. in src/server/workflow-engine/ensure-plugin-installed.ts after the
 * plugin health check passes, or in the TanStack Start server entry point
 * (src/entry-server.tsx / vinxi server hook) before routes are registered.
 * It is intentionally NOT auto-wired here — the caller decides.
 */

import { existsSync, readdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';

import Database from 'better-sqlite3';

import { PluginClient } from './clients/plugin-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveNativeDbPath(): string {
  return (
    process.env.HERMES_WORKFLOW_DB_PATH ||
    process.env.SWITCHUI_WORKFLOW_DB_PATH ||
    join(homedir(), '.hermes', 'switchui-workflows.db')
  );
}

function hasMigratedMarker(dbPath: string): boolean {
  const dir = dirname(dbPath);
  const name = basename(dbPath);
  try {
    const files = readdirSync(dir);
    return files.some((f) => f.startsWith(`${name}.migrated-`));
  } catch {
    return false;
  }
}

interface NativeDefinitionRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  scope_path: string | null;
  yaml: string;
  checksum: string;
  version: string | null;
  tags: string | null;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function migrateNativeWorkflowDbOnce(): Promise<void> {
  const dbPath = resolveNativeDbPath();

  // Guard 1: native DB does not exist → nothing to do
  if (!existsSync(dbPath)) {
    console.log('[migrate-native-db] No native workflow DB found at', dbPath, '— skipping.');
    return;
  }

  // Guard 2: already ran → no-op
  if (hasMigratedMarker(dbPath)) {
    console.log('[migrate-native-db] Migration marker present — already migrated, skipping.');
    return;
  }

  console.log('[migrate-native-db] Opening native DB (read-only):', dbPath);

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  let rows: NativeDefinitionRow[];
  try {
    rows = db
      .prepare(
        `SELECT id, name, description, source, scope_path, yaml, checksum, version, tags, created_at, updated_at
         FROM workflow_definitions
         WHERE source IN ('user', 'project')`,
      )
      .all() as NativeDefinitionRow[];
  } finally {
    db.close();
  }

  console.log(`[migrate-native-db] Found ${rows.length} user/project definition(s) to migrate.`);

  if (rows.length === 0) {
    // No user/project rows — still rename the DB so this check doesn't repeat.
    const ts = Date.now();
    const dest = `${dbPath}.migrated-${ts}`;
    renameSync(dbPath, dest);
    console.log(`[migrate-native-db] No rows to migrate. Renamed DB → ${dest}`);
    return;
  }

  const client = new PluginClient();
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      await client.upsertDefinition(row.yaml, row.scope_path ?? undefined);
      imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 409 = already exists in plugin DB → skip gracefully
      // Any 4xx = plugin rejected it (bad YAML, collision, etc.) → skip + log
      if (/40[0-9]/.test(msg)) {
        console.warn(`[migrate-native-db] Skip "${row.id}" (${msg.slice(0, 120)})`);
        skipped++;
      } else {
        // Unexpected error — log but continue so one bad row doesn't abort all
        console.error(`[migrate-native-db] Error importing "${row.id}":`, msg);
        skipped++;
      }
    }
  }

  // Rename (soft-retire) the native DB — never delete
  const ts = Date.now();
  const dest = `${dbPath}.migrated-${ts}`;
  renameSync(dbPath, dest);

  console.log(
    `[migrate-native-db] Done. imported=${imported} skipped=${skipped} renamed=${dest}`,
  );
}
