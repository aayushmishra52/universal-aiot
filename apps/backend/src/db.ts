import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { migrations } from "./migrations/index.js";

/** better-sqlite3 database instance type (the default import is the constructor value). */
export type Db = InstanceType<typeof Database>;

/** Open the SQLite database, enable WAL, and run pending migrations. */
export function openDatabase(config: AppConfig): Db {
  const dir = path.dirname(config.databasePath);
  if (dir && dir !== "." && dir !== "") {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function runMigrations(db: Db): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set<string>(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  // Migrations are bundled TS modules (see src/migrations), so they resolve
  // identically under tsx, tests, and compiled dist output.
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
      migration.name,
      Date.now(),
    );
  }
}
