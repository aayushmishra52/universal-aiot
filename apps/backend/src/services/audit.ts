import type { Database } from "better-sqlite3";

/** Append an audit entry. `detail` must never contain secrets. */
export function audit(
  db: Database,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
): void {
  db.prepare(
    "INSERT INTO audit_log (at, actor, action, detail_json) VALUES (?, ?, ?, ?)",
  ).run(Date.now(), actor, action, JSON.stringify(detail));
}
