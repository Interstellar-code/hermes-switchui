import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";

function freshDb(): Database.Database {
  return new Database(":memory:");
}

describe("runMigrations", () => {
  it("fresh in-memory DB → migrations applied → schema_version='1'", () => {
    const db = freshDb();
    runMigrations(db);
    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key='schema_version'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe("1");
    db.close();
  });

  it("re-running migration runner is a no-op (idempotent)", () => {
    const db = freshDb();
    runMigrations(db);
    // Second run must not throw and version stays at '1'
    expect(() => runMigrations(db)).not.toThrow();
    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key='schema_version'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe("1");
    db.close();
  });

  it("tampered schema_meta with non-numeric version → throws", () => {
    const db = freshDb();
    runMigrations(db);
    // Tamper the version to a non-numeric string
    db.prepare("UPDATE schema_meta SET value='corrupt' WHERE key='schema_version'").run();
    expect(() => runMigrations(db)).toThrow(/Unexpected schema_version/);
    db.close();
  });
});
