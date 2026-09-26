/**
 * Ordered migration registry. New migrations are added here (and as new
 * modules) in apply order; `runMigrations` in db.ts applies any that have
 * not been recorded in schema_migrations yet.
 */
import { name as name001, sql as sql001 } from "./001_init.js";
import { name as name002, sql as sql002 } from "./002_federated_identities.js";
import { name as name003, sql as sql003 } from "./003_device_credentials.js";

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  { name: name001, sql: sql001 },
  { name: name002, sql: sql002 },
  { name: name003, sql: sql003 },
];
