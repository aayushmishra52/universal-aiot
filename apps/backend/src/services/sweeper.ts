import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { broadcastRealtime } from "../realtime.js";
import { audit } from "./audit.js";
import { nowMs } from "../util.js";
import type { AppConfig } from "../config.js";

/**
 * Mark PENDING/SENT commands whose expiry has passed as EXPIRED,
 * recording a synthetic result row and broadcasting `command.failed`.
 * Returns the number of commands expired.
 */
export function sweepExpiredCommands(db: Database): number {
  const now = nowMs();
  const rows = db
    .prepare(
      `SELECT c.command_id AS command_id, c.device_id_fk AS device_id,
              d.project_id AS project_id
       FROM commands c JOIN devices d ON d.device_id = c.device_id_fk
       WHERE c.status IN ('PENDING', 'SENT') AND c.expires_at < ?`,
    )
    .all(now) as { command_id: string; device_id: string; project_id: string }[];

  const tx = db.transaction(() => {
    for (const row of rows) {
      db.prepare("UPDATE commands SET status = 'EXPIRED' WHERE command_id = ?").run(
        row.command_id,
      );
      db.prepare(
        `INSERT OR IGNORE INTO command_results
         (id, command_id, status, reason, at) VALUES (?, ?, 'EXPIRED', 'expired', ?)`,
      ).run(randomUUID(), row.command_id, now);
      audit(db, "system", "command.expired", {
        commandId: row.command_id,
        deviceId: row.device_id,
      });
      broadcastRealtime({
        kind: "command.failed",
        projectId: row.project_id,
        deviceId: row.device_id,
        at: now,
        data: { commandId: row.command_id, reason: "expired" },
      });
    }
  });
  tx();
  return rows.length;
}

export interface SweeperHandle {
  stop: () => void;
}

/** Start the periodic expiry sweeper. */
export function startSweeper(db: Database, config: AppConfig): SweeperHandle {
  const timer = setInterval(() => {
    try {
      sweepExpiredCommands(db);
    } catch (err) {
      console.error("[sweeper] failure:", (err as Error)?.message ?? err);
    }
  }, config.sweepIntervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
