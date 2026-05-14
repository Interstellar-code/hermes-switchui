import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";

export const DEFAULT_DB_PATH = join(homedir(), ".hermes", "switchui-workflows.db");
const LOCK_PATH = `${DEFAULT_DB_PATH}.lock`;

let dbInstance: Database.Database | null = null;
let lockFd: number | null = null;
let lockPath: string | null = null;

function releaseLock(): void {
  if (lockFd !== null) {
    try { closeSync(lockFd); } catch { /* ignore */ }
    lockFd = null;
  }
  if (lockPath !== null) {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
    lockPath = null;
  }
}

export function openDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  // :memory: paths skip the singleton — each call creates a fresh DB so
  // multiple test fixtures in the same test file don't share state.
  if (dbPath === ":memory:") {
    const memDb = new Database(":memory:");
    memDb.pragma("journal_mode = WAL");
    memDb.pragma("foreign_keys = ON");
    memDb.pragma("busy_timeout = 5000");
    return memDb;
  }

  if (dbInstance) return dbInstance;

  const hermesDir = join(homedir(), ".hermes");
  mkdirSync(hermesDir, { recursive: true });

  if (dbPath !== ":memory:") {
    const currentLockPath = `${dbPath}.lock`;
    try {
      lockFd = openSync(currentLockPath, "wx");
      lockPath = currentLockPath;
      process.on("exit", releaseLock);
      process.on("SIGINT", () => { releaseLock(); process.exit(0); });
      process.on("SIGTERM", () => { releaseLock(); process.exit(0); });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `Switch UI workflow engine: another instance holds ${currentLockPath}. Refusing to start.`
        );
      }
      throw err;
    }
  }

  dbInstance = new Database(dbPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  dbInstance.pragma("busy_timeout = 5000");
  return dbInstance;
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    throw new Error("DB not opened. Call openDb() first.");
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  releaseLock();
}

// Re-export lock path for testing
export { LOCK_PATH };
