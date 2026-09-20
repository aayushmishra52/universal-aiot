import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  PROTOCOL_VERSION,
  validateCapabilityValue,
  type Capability,
  type Command,
} from "@aiot/contracts";
import { publishCommand } from "../mqtt/publish.js";
import { broadcastRealtime } from "../realtime.js";
import { audit } from "./audit.js";
import { nowMs, randomAlnum, safeJsonParse } from "../util.js";

export class CommandError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(code: string, statusCode: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface SendCommandInput {
  deviceId: string;
  capabilityId: string;
  action?: string;
  params?: Record<string, unknown>;
  ttlMs?: number;
  /** Audit actor, e.g. `user:<id>` or `automation:<id>`. */
  actor: string;
}

export interface CommandRecord {
  id: string;
  command_id: string;
  device_id_fk: string;
  capability_id: string;
  action: string;
  params: Record<string, unknown>;
  issued_at: number;
  expires_at: number;
  status: string;
  created_by: string;
}

function capabilityRowToCapability(row: {
  capability_id: string;
  name: string;
  type: string;
  kind: string;
  unit: string | null;
  min: number | null;
  max: number | null;
  precision: number | null;
  sampling_interval: number | null;
  read_only: number;
  enum_values: string | null;
  category: string | null;
}): Capability {
  return {
    id: row.capability_id,
    name: row.name,
    type: row.type as Capability["type"],
    kind: row.kind as Capability["kind"],
    ...(row.unit ? { unit: row.unit } : {}),
    ...(row.min !== null ? { min: row.min } : {}),
    ...(row.max !== null ? { max: row.max } : {}),
    ...(row.precision !== null ? { precision: row.precision } : {}),
    ...(row.sampling_interval !== null ? { samplingInterval: row.sampling_interval } : {}),
    ...(row.read_only ? { readOnly: true } : {}),
    ...(row.enum_values ? { enumValues: safeJsonParse<string[]>(row.enum_values, []) } : {}),
    ...(row.category ? { category: row.category } : {}),
  };
}

/**
 * Shared command pipeline used by the REST route and the automation engine:
 * validate capability + value, persist PENDING, publish over MQTT, mark SENT,
 * audit, and broadcast the realtime event.
 */
export async function sendCommand(
  db: Database,
  input: SendCommandInput,
): Promise<CommandRecord> {
  const device = db
    .prepare("SELECT device_id, project_id, org_id FROM devices WHERE device_id = ?")
    .get(input.deviceId) as
    | { device_id: string; project_id: string; org_id: string }
    | undefined;
  if (!device) {
    throw new CommandError("device_not_found", 404);
  }
  const capRow = db
    .prepare(
      "SELECT * FROM capabilities WHERE device_id_fk = ? AND capability_id = ?",
    )
    .get(input.deviceId, input.capabilityId) as Parameters<
    typeof capabilityRowToCapability
  >[0] | undefined;
  if (!capRow) {
    throw new CommandError("invalid_capability", 400, "unknown capability");
  }
  if (capRow.kind !== "actuator") {
    throw new CommandError("invalid_capability", 400, "capability is not an actuator");
  }
  const capability = capabilityRowToCapability(capRow);
  const params = input.params ?? {};
  const check = validateCapabilityValue(capability, (params as { value?: unknown }).value ?? params);
  if (!check.ok) {
    throw new CommandError("invalid_parameter", 400, check.reason);
  }

  const now = nowMs();
  const ttlMs = input.ttlMs ?? 30_000;
  const command: Command = {
    kind: "command",
    protocolVersion: PROTOCOL_VERSION,
    commandId: `cmd_${randomAlnum(16)}`,
    deviceId: input.deviceId,
    capabilityId: input.capabilityId,
    action: input.action ?? "set",
    params,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  const id = randomUUID();
  db.prepare(
    `INSERT INTO commands
     (id, command_id, device_id_fk, capability_id, action, params_json,
      issued_at, expires_at, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
  ).run(
    id,
    command.commandId,
    input.deviceId,
    input.capabilityId,
    command.action,
    JSON.stringify(params),
    command.issuedAt,
    command.expiresAt,
    input.actor,
  );

  await publishCommand(device.org_id, device.project_id, device.device_id, command);
  db.prepare("UPDATE commands SET status = 'SENT' WHERE command_id = ?").run(
    command.commandId,
  );

  audit(db, input.actor, "command.created", {
    commandId: command.commandId,
    deviceId: input.deviceId,
    capabilityId: input.capabilityId,
    action: command.action,
  });
  broadcastRealtime({
    kind: "command.created",
    projectId: device.project_id,
    deviceId: input.deviceId,
    at: now,
    data: {
      commandId: command.commandId,
      capabilityId: input.capabilityId,
      action: command.action,
    },
  });

  return {
    id,
    command_id: command.commandId,
    device_id_fk: input.deviceId,
    capability_id: input.capabilityId,
    action: command.action,
    params,
    issued_at: command.issuedAt,
    expires_at: command.expiresAt,
    status: "SENT",
    created_by: input.actor,
  };
}
