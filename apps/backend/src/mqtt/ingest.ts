import type { AedesBroker } from "./broker.js";
import type { Database } from "better-sqlite3";
import {
  CommandResultSchema,
  DeviceManifestSchema,
  DeviceStatusSchema,
  HealthSchema,
  PresenceSchema,
  TelemetrySchema,
  parseTopic,
  type DeviceManifest,
} from "@aiot/contracts";
import { broadcastRealtime } from "../realtime.js";
import { evaluateAutomations } from "../rules/engine.js";
import { nowMs, safeJsonParse } from "../util.js";

/**
 * Attach the ingest pipeline to the broker.
 *
 * Every device publish is parsed, schema-validated with @aiot/contracts,
 * persisted, and fanned out to realtime/automations. Invalid payloads are
 * logged and ignored — the broker must never crash on device input.
 */
export function attachIngest(db: Database, broker: AedesBroker): void {
  broker.on("publish", (packet, client) => {
    handlePublish(db, packet, client).catch((err) => {
      console.error("[mqtt] ingest failure:", (err as Error)?.message ?? err);
    });
  });
}

async function handlePublish(
  db: Database,
  packet: { topic: string; payload: Buffer | Uint8Array | string },
  client: unknown,
): Promise<void> {
  // Server-originated publishes (commands) carry no client.
  if (!client) return;
  const parsed = parseTopic(packet.topic);
  if (!parsed) return;
  const authed = (client as { device?: { deviceId: string } }).device;
  if (!authed || authed.deviceId !== parsed.deviceId) return;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(packet.payload as Uint8Array).toString("utf8"));
  } catch {
    return;
  }
  if (typeof payload !== "object" || payload === null) return;

  try {
    switch (parsed.kind) {
      case "manifest":
        handleManifest(db, parsed.deviceId, payload);
        break;
      case "telemetry":
        await handleTelemetry(db, parsed.deviceId, payload);
        break;
      case "command":
        handleCommandResult(db, parsed.deviceId, payload);
        break;
      case "presence":
        handlePresence(db, parsed.deviceId, payload);
        break;
      case "health":
        handleHealth(db, parsed.deviceId, payload);
        break;
      case "status":
        handleStatus(db, parsed.deviceId, payload);
        break;
    }
  } catch (err) {
    console.error(
      `[mqtt] ingest error (${parsed.kind} from ${parsed.deviceId}):`,
      (err as Error)?.message ?? err,
    );
  }
}

function deviceProject(db: Database, deviceId: string): string | null {
  const row = db
    .prepare("SELECT project_id FROM devices WHERE device_id = ?")
    .get(deviceId) as { project_id: string } | undefined;
  return row?.project_id ?? null;
}

function handleManifest(db: Database, deviceId: string, payload: unknown): void {
  const parsed = DeviceManifestSchema.safeParse(payload);
  if (!parsed.success || parsed.data.deviceId !== deviceId) return;
  const manifest: DeviceManifest = parsed.data;
  const now = nowMs();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM capabilities WHERE device_id_fk = ?").run(deviceId);
    const insert = db.prepare(
      `INSERT INTO capabilities
       (device_id_fk, capability_id, name, type, kind, unit, min, max, precision,
        sampling_interval, read_only, enum_values, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const cap of manifest.capabilities) {
      insert.run(
        deviceId,
        cap.id,
        cap.name,
        cap.type,
        cap.kind,
        cap.unit ?? null,
        cap.min ?? null,
        cap.max ?? null,
        cap.precision ?? null,
        cap.samplingInterval ?? null,
        cap.readOnly ? 1 : 0,
        cap.enumValues ? JSON.stringify(cap.enumValues) : null,
        cap.category ?? null,
      );
    }
    db.prepare(
      `UPDATE devices SET type = ?, model = ?, firmware_version = ?,
        protocol_version = ?, last_seen = ? WHERE device_id = ?`,
    ).run(
      manifest.deviceType,
      manifest.model,
      manifest.firmwareVersion,
      manifest.protocolVersion,
      now,
      deviceId,
    );
  });
  tx();
}

async function handleTelemetry(
  db: Database,
  deviceId: string,
  payload: unknown,
): Promise<void> {
  const parsed = TelemetrySchema.safeParse(payload);
  if (!parsed.success || parsed.data.deviceId !== deviceId) return;
  const telemetry = parsed.data;
  const now = nowMs();
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO telemetry
       (device_id_fk, ts, seq, message_id, values_json, quality)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      deviceId,
      telemetry.timestamp,
      telemetry.sequence,
      telemetry.messageId,
      JSON.stringify(telemetry.values),
      telemetry.quality ?? null,
    ).changes;
  if (inserted === 0) return; // duplicate message_id: deduped
  db.prepare("UPDATE devices SET last_seen = ?, status = 'ONLINE' WHERE device_id = ?").run(
    now,
    deviceId,
  );
  const projectId = deviceProject(db, deviceId);
  if (projectId) {
    broadcastRealtime({
      kind: "device.telemetry",
      projectId,
      deviceId,
      at: now,
      data: { values: telemetry.values, messageId: telemetry.messageId },
    });
  }
  await evaluateAutomations(db, deviceId, telemetry.values as Record<string, unknown>);
}

function handleCommandResult(db: Database, deviceId: string, payload: unknown): void {
  // Only results flow device -> backend; command payloads are server-originated.
  if ((payload as { kind?: unknown }).kind !== "result") return;
  const parsed = CommandResultSchema.safeParse(payload);
  if (!parsed.success || parsed.data.deviceId !== deviceId) return;
  const result = parsed.data;
  const command = db
    .prepare("SELECT * FROM commands WHERE command_id = ? AND device_id_fk = ?")
    .get(result.commandId, deviceId) as
    | { command_id: string; capability_id: string }
    | undefined;
  if (!command) return;
  const now = nowMs();
  // A command carries exactly one result row. The first result is recorded;
  // a nonterminal result (e.g. ACKNOWLEDGED) may then advance to a terminal
  // one (e.g. SUCCEEDED). Replays and post-terminal results are ignored so
  // state is never double-applied.
  const TERMINAL = new Set(["SUCCEEDED", "FAILED", "EXPIRED", "REJECTED"]);
  const existing = db
    .prepare("SELECT status FROM command_results WHERE command_id = ?")
    .get(result.commandId) as { status: string } | undefined;
  const reportedJson = result.reportedState ? JSON.stringify(result.reportedState) : null;
  let applied = false;
  if (!existing) {
    db.prepare(
      `INSERT INTO command_results
       (id, command_id, status, reason, reported_state_json, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      `res_${now}_${result.commandId}`,
      result.commandId,
      result.status,
      result.reason ?? null,
      reportedJson,
      result.at,
    );
    applied = true;
  } else if (!TERMINAL.has(existing.status) && existing.status !== result.status) {
    db.prepare(
      `UPDATE command_results
       SET status = ?, reason = ?, reported_state_json = ?, at = ?
       WHERE command_id = ?`,
    ).run(result.status, result.reason ?? null, reportedJson, result.at, result.commandId);
    applied = true;
  }
  if (!applied) return;
  db.prepare("UPDATE commands SET status = ? WHERE command_id = ?").run(
    result.status,
    result.commandId,
  );
  if (result.reportedState && Object.keys(result.reportedState).length > 0) {
    const stateRow = db
      .prepare("SELECT reported_json FROM device_state WHERE device_id_fk = ?")
      .get(deviceId) as { reported_json: string } | undefined;
    const reported = safeJsonParse<Record<string, unknown>>(
      stateRow?.reported_json,
      {},
    );
    for (const [key, value] of Object.entries(result.reportedState)) {
      reported[key] = value;
    }
    db.prepare(
      `INSERT INTO device_state (device_id_fk, desired_json, reported_json, updated_at)
       VALUES (?, '{}', ?, ?)
       ON CONFLICT(device_id_fk) DO UPDATE SET reported_json = excluded.reported_json,
         updated_at = excluded.updated_at`,
    ).run(deviceId, JSON.stringify(reported), now);
  }
  const projectId = deviceProject(db, deviceId);
  if (projectId) {
    const kind =
      result.status === "FAILED" || result.status === "REJECTED"
        ? "command.failed"
        : "command.acknowledged";
    broadcastRealtime({
      kind,
      projectId,
      deviceId,
      at: now,
      data: {
        commandId: result.commandId,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });
  }
}

function handlePresence(db: Database, deviceId: string, payload: unknown): void {
  const parsed = PresenceSchema.safeParse(payload);
  if (!parsed.success || parsed.data.deviceId !== deviceId) return;
  const presence = parsed.data;
  db.prepare("UPDATE devices SET status = ?, last_seen = ? WHERE device_id = ?").run(
    presence.online ? "ONLINE" : "OFFLINE",
    presence.at,
    deviceId,
  );
  const projectId = deviceProject(db, deviceId);
  if (projectId) {
    broadcastRealtime({
      kind: presence.online ? "device.online" : "device.offline",
      projectId,
      deviceId,
      at: presence.at,
      data: {},
    });
  }
}

function handleHealth(db: Database, deviceId: string, payload: unknown): void {
  const parsed = HealthSchema.safeParse(payload);
  if (!parsed.success || parsed.data.deviceId !== deviceId) return;
  const health = parsed.data;
  db.prepare(
    `INSERT INTO device_health
     (device_id_fk, uptime, free_heap, wifi_rssi, mqtt, firmware, sensor_errors,
      capability_health_json, last_telemetry_at, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id_fk) DO UPDATE SET
       uptime = excluded.uptime, free_heap = excluded.free_heap,
       wifi_rssi = excluded.wifi_rssi, mqtt = excluded.mqtt,
       firmware = excluded.firmware, sensor_errors = excluded.sensor_errors,
       capability_health_json = excluded.capability_health_json,
       last_telemetry_at = excluded.last_telemetry_at, at = excluded.at`,
  ).run(
    deviceId,
    health.uptime,
    health.freeHeap ?? null,
    health.wifiRssi ?? null,
    health.mqtt,
    health.firmware,
    health.sensorErrors,
    JSON.stringify(health.capabilityHealth),
    health.lastTelemetryAt ?? null,
    health.at,
  );
  const projectId = deviceProject(db, deviceId);
  if (projectId) {
    broadcastRealtime({
      kind: "device.health",
      projectId,
      deviceId,
      at: health.at,
      data: {
        uptime: health.uptime,
        wifiRssi: health.wifiRssi ?? null,
        sensorErrors: health.sensorErrors,
      },
    });
  }
}

function handleStatus(db: Database, deviceId: string, payload: unknown): void {
  const parsed = DeviceStatusSchema.safeParse(payload);
  if (!parsed.success || parsed.data.deviceId !== deviceId) return;
  const status = parsed.data;
  db.prepare("UPDATE devices SET status = ?, last_seen = ? WHERE device_id = ?").run(
    status.state,
    status.at,
    deviceId,
  );
  const projectId = deviceProject(db, deviceId);
  if (projectId) {
    broadcastRealtime({
      kind: "device.state_changed",
      projectId,
      deviceId,
      at: status.at,
      data: { state: status.state },
    });
  }
}
