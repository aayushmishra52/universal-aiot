/**
 * Ordered migration registry. New migrations are added here (and as new
 * modules) in apply order; `runMigrations` in db.ts applies any that have
 * not been recorded in schema_migrations yet.
 */
import { name as name001, sql as sql001 } from "./001_init.js";

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [{ name: name001, sql: sql001 }];
