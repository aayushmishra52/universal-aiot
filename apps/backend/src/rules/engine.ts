import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { sendCommand } from "../services/commands.js";
import { broadcastRealtime } from "../realtime.js";
import { audit } from "../services/audit.js";
import { nowMs, safeJsonParse } from "../util.js";
import type { AutomationAction, AutomationCondition } from "@aiot/contracts";

/** Minimum time between two firings of the same automation. */
const COOLDOWN_MS = 60_000;

function compare(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case ">":
      return (actual as number) > (expected as number);
    case ">=":
      return (actual as number) >= (expected as number);
    case "<":
      return (actual as number) < (expected as number);
    case "<=":
      return (actual as number) <= (expected as number);
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    default:
      return false;
  }
}

/**
 * Evaluate enabled automations for a device against freshly ingested telemetry
 * values. Matching rules fire `sendCommand()` (actor `automation:<id>`),
 * record a run, and broadcast `automation.triggered`. Rules in cooldown are
 * skipped. Failures are logged and never break telemetry ingest.
 */
export async function evaluateAutomations(
  db: Database,
  deviceId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const device = db
    .prepare("SELECT device_id, project_id FROM devices WHERE device_id = ?")
    .get(deviceId) as { device_id: string; project_id: string } | undefined;
  if (!device) return;

  const rules = db
    .prepare(
      `SELECT * FROM automations
       WHERE project_id = ? AND enabled = 1 AND (device_id IS NULL OR device_id = ?)`,
    )
    .all(device.project_id, deviceId) as {
    id: string;
    device_id: string | null;
    name: string;
    condition_json: string;
    action_json: string;
    last_triggered: number | null;
  }[];

  const now = nowMs();
  for (const rule of rules) {
    if (rule.last_triggered !== null && now - rule.last_triggered < COOLDOWN_MS) {
      continue;
    }
    const condition = safeJsonParse<AutomationCondition>(rule.condition_json, null as never);
    const action = safeJsonParse<AutomationAction>(rule.action_json, null as never);
    if (!condition || !action) continue;
    const actual = values[condition.capabilityId];
    if (actual === undefined) continue;
    if (!compare(actual, condition.operator, condition.value)) continue;

    const targetDevice = rule.device_id ?? deviceId;
    try {
      const command = await sendCommand(db, {
        deviceId: targetDevice,
        capabilityId: action.capabilityId,
        action: action.action ?? "set",
        params: (action.params ?? {}) as Record<string, unknown>,
        ttlMs: 30_000,
        actor: `automation:${rule.id}`,
      });
      db.prepare("UPDATE automations SET last_triggered = ? WHERE id = ?").run(now, rule.id);
      db.prepare(
        "INSERT INTO automation_runs (id, automation_id, at, detail_json) VALUES (?, ?, ?, ?)",
      ).run(
        randomUUID(),
        rule.id,
        now,
        JSON.stringify({
          deviceId: targetDevice,
          condition: condition,
          commandId: command.command_id,
        }),
      );
      audit(db, `automation:${rule.id}`, "automation.triggered", {
        automationId: rule.id,
        deviceId: targetDevice,
        commandId: command.command_id,
      });
      broadcastRealtime({
        kind: "automation.triggered",
        projectId: device.project_id,
        deviceId: targetDevice,
        at: now,
        data: { automationId: rule.id, commandId: command.command_id },
      });
    } catch (err) {
      console.error(
        `[automation] rule ${rule.id} failed:`,
        (err as Error)?.message ?? err,
      );
    }
  }
}
