import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import {
  accessDenied,
  requireDeviceAccess,
  requireProjectAccess,
  type DeviceRow,
} from "../authz.js";
import { audit } from "../services/audit.js";
import { nowMs, pairingUsernameFor, randomAlnum, safeJsonParse } from "../util.js";

const CreateDeviceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(200).optional(),
});

const TelemetryQuerySchema = z.object({
  capability: z.string().min(1).max(64).optional(),
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

function generateDeviceId(db: import("better-sqlite3").Database): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = `DEV-${randomAlnum(7)}`;
    const exists = db.prepare("SELECT 1 FROM devices WHERE device_id = ?").get(id);
    if (!exists) return id;
  }
  throw new Error("failed to generate a unique device id");
}

function serializeDevice(device: DeviceRow) {
  return {
    id: device.id,
    deviceId: device.device_id,
    projectId: device.project_id,
    orgId: device.org_id,
    name: device.name,
    type: device.type,
    model: device.model,
    firmwareVersion: device.firmware_version,
    protocolVersion: device.protocol_version,
    status: device.status,
    lastSeen: device.last_seen,
    createdAt: device.created_at,
  };
}

function serializeCapability(row: {
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
}) {
  return {
    id: row.capability_id,
    name: row.name,
    type: row.type,
    kind: row.kind,
    unit: row.unit,
    min: row.min,
    max: row.max,
    precision: row.precision,
    samplingInterval: row.sampling_interval,
    readOnly: row.read_only === 1,
    enumValues: row.enum_values ? safeJsonParse<string[]>(row.enum_values, []) : undefined,
    category: row.category,
  };
}

export default async function deviceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/projects/:projectId/devices",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireProjectAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { projectId: string }).projectId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const parsed = CreateDeviceSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

      const db = fastify.db;
      const deviceId = generateDeviceId(db);
      const username = pairingUsernameFor(deviceId);
      // Shown ONCE in the response; only the bcrypt hash is stored.
      const pairingPassword = randomAlnum(24);
      const id = randomUUID();
      const now = nowMs();
      db.transaction(() => {
        db.prepare(
          `INSERT INTO devices
           (id, device_id, project_id, org_id, name, type, model, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'OFFLINE', ?)`,
        ).run(
          id,
          deviceId,
          access.value.project.id,
          access.value.orgId,
          parsed.data.name,
          parsed.data.type ?? null,
          parsed.data.model ?? null,
          now,
        );
        db.prepare(
          `INSERT INTO device_state (device_id_fk, desired_json, reported_json, updated_at)
           VALUES (?, '{}', '{}', ?)`,
        ).run(deviceId, now);
        db.prepare(
          `INSERT INTO pairings
           (id, device_id_fk, username, password_hash, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          deviceId,
          username,
          hashPassword(pairingPassword),
          now + fastify.config.pairingTtlMs,
          now,
        );
      })();
      audit(db, `user:${request.user!.userId}`, "device.created", {
        deviceId,
        projectId: access.value.project.id,
        name: parsed.data.name,
      });
      const device = db
        .prepare("SELECT * FROM devices WHERE device_id = ?")
        .get(deviceId) as DeviceRow;
      return reply.code(201).send({
        device: serializeDevice(device),
        pairing: { deviceId, username, password: pairingPassword },
      });
    },
  );

  fastify.get(
    "/projects/:projectId/devices",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireProjectAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { projectId: string }).projectId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const rows = fastify.db
        .prepare(
          `SELECT d.*, COUNT(c.capability_id) AS capability_count
           FROM devices d LEFT JOIN capabilities c ON c.device_id_fk = d.device_id
           WHERE d.project_id = ? GROUP BY d.device_id ORDER BY d.created_at DESC`,
        )
        .all(access.value.project.id) as (DeviceRow & { capability_count: number })[];
      return {
        devices: rows.map((d) => ({
          ...serializeDevice(d),
          capabilityCount: d.capability_count,
        })),
      };
    },
  );

  fastify.get(
    "/devices/:deviceId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireDeviceAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { deviceId: string }).deviceId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const db = fastify.db;
      const deviceId = access.value.device.device_id;
      const capabilities = (
        db
          .prepare("SELECT * FROM capabilities WHERE device_id_fk = ? ORDER BY capability_id")
          .all(deviceId) as Parameters<typeof serializeCapability>[0][]
      ).map(serializeCapability);
      const stateRow = db
        .prepare("SELECT desired_json, reported_json, updated_at FROM device_state WHERE device_id_fk = ?")
        .get(deviceId) as
        | { desired_json: string; reported_json: string; updated_at: number }
        | undefined;
      const healthRow = db
        .prepare("SELECT * FROM device_health WHERE device_id_fk = ?")
        .get(deviceId) as Record<string, unknown> | undefined;
      return {
        device: serializeDevice(access.value.device),
        capabilities,
        state: stateRow
          ? {
              desired: safeJsonParse(stateRow.desired_json, {}),
              reported: safeJsonParse(stateRow.reported_json, {}),
              updatedAt: stateRow.updated_at,
            }
          : null,
        health: healthRow ? serializeHealth(healthRow) : null,
      };
    },
  );

  fastify.delete(
    "/devices/:deviceId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireDeviceAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { deviceId: string }).deviceId,
        "ADMIN",
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const db = fastify.db;
      const deviceId = access.value.device.device_id;
      const now = nowMs();
      db.transaction(() => {
        db.prepare("UPDATE pairings SET revoked_at = ? WHERE device_id_fk = ? AND revoked_at IS NULL")
          .run(now, deviceId);
        db.prepare(
          "UPDATE device_credentials SET revoked_at = ? WHERE device_id_fk = ? AND revoked_at IS NULL",
        ).run(now, deviceId);
        db.prepare("DELETE FROM devices WHERE device_id = ?").run(deviceId);
      })();
      audit(db, `user:${request.user!.userId}`, "device.deleted", {
        deviceId,
        projectId: access.value.projectId,
      });
      return { ok: true, deviceId };
    },
  );

  fastify.post(
    "/devices/:deviceId/credentials/rotate",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireDeviceAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { deviceId: string }).deviceId,
        "ADMIN",
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const db = fastify.db;
      const deviceId = access.value.device.device_id;
      const username = pairingUsernameFor(deviceId);
      // Shown ONCE; only the bcrypt hash is stored.
      const deviceToken = randomAlnum(32);
      const now = nowMs();
      db.transaction(() => {
        db.prepare(
          "UPDATE device_credentials SET revoked_at = ? WHERE device_id_fk = ? AND revoked_at IS NULL",
        ).run(now, deviceId);
        db.prepare(
          `INSERT INTO device_credentials (id, device_id_fk, username, password_hash, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(randomUUID(), deviceId, username, hashPassword(deviceToken), now);
      })();
      audit(db, `user:${request.user!.userId}`, "device.credentials_rotated", {
        deviceId,
        projectId: access.value.projectId,
      });
      return { ok: true, deviceId, username, deviceToken };
    },
  );

  fastify.get(
    "/devices/:deviceId/telemetry",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireDeviceAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { deviceId: string }).deviceId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const query = TelemetryQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "invalid_request" });
      const { capability, from, to, limit } = query.data;
      const conditions = ["device_id_fk = ?"];
      const args: unknown[] = [access.value.device.device_id];
      if (from !== undefined) {
        conditions.push("ts >= ?");
        args.push(from);
      }
      if (to !== undefined) {
        conditions.push("ts <= ?");
        args.push(to);
      }
      const rows = fastify.db
        .prepare(
          `SELECT ts, seq, message_id, values_json, quality FROM telemetry
           WHERE ${conditions.join(" AND ")} ORDER BY ts DESC LIMIT ?`,
        )
        .all(...args, limit) as {
        ts: number;
        seq: number;
        message_id: string;
        values_json: string;
        quality: string | null;
      }[];
      const points = rows
        .map((r) => ({
          ts: r.ts,
          seq: r.seq,
          messageId: r.message_id,
          values: safeJsonParse<Record<string, unknown>>(r.values_json, {}),
          quality: r.quality,
        }))
        .filter((p) => !capability || p.values[capability] !== undefined);
      return { telemetry: points };
    },
  );

  fastify.get(
    "/devices/:deviceId/state",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireDeviceAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { deviceId: string }).deviceId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const row = fastify.db
        .prepare("SELECT desired_json, reported_json, updated_at FROM device_state WHERE device_id_fk = ?")
        .get(access.value.device.device_id) as
        | { desired_json: string; reported_json: string; updated_at: number }
        | undefined;
      return {
        state: row
          ? {
              desired: safeJsonParse(row.desired_json, {}),
              reported: safeJsonParse(row.reported_json, {}),
              updatedAt: row.updated_at,
            }
          : null,
      };
    },
  );

  fastify.get(
    "/devices/:deviceId/health",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireDeviceAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { deviceId: string }).deviceId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const row = fastify.db
        .prepare("SELECT * FROM device_health WHERE device_id_fk = ?")
        .get(access.value.device.device_id) as Record<string, unknown> | undefined;
      return { health: row ? serializeHealth(row) : null };
    },
  );

  fastify.get(
    "/devices/:deviceId/events",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireDeviceAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { deviceId: string }).deviceId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const rows = fastify.db
        .prepare(
          `SELECT at, actor, action, detail_json FROM audit_log
           WHERE json_extract(detail_json, '$.deviceId') = ?
           ORDER BY at DESC LIMIT 100`,
        )
        .all(access.value.device.device_id) as {
        at: number;
        actor: string;
        action: string;
        detail_json: string;
      }[];
      return {
        events: rows.map((r) => ({
          at: r.at,
          actor: r.actor,
          action: r.action,
          detail: safeJsonParse(r.detail_json, {}),
        })),
      };
    },
  );
}

function serializeHealth(row: Record<string, unknown>) {
  return {
    uptime: row.uptime,
    freeHeap: row.free_heap,
    wifiRssi: row.wifi_rssi,
    mqtt: row.mqtt,
    firmware: row.firmware,
    sensorErrors: row.sensor_errors,
    capabilityHealth: safeJsonParse(row.capability_health_json as string, {}),
    lastTelemetryAt: row.last_telemetry_at,
    at: row.at,
  };
}
