import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AutomationSchema } from "@aiot/contracts";
import { requireAuth } from "../auth/middleware.js";
import { accessDenied, requireProjectAccess } from "../authz.js";
import { audit } from "../services/audit.js";
import { nowMs, safeJsonParse } from "../util.js";

// Request body: AutomationSchema minus the server-owned projectId/id fields.
const AutomationBodySchema = AutomationSchema.omit({ projectId: true, id: true });

function serializeRow(row: {
  id: string;
  project_id: string;
  device_id: string | null;
  name: string;
  enabled: number;
  condition_json: string;
  action_json: string;
  last_triggered: number | null;
  created_at: number;
}) {
  return {
    id: row.id,
    projectId: row.project_id,
    deviceId: row.device_id,
    name: row.name,
    enabled: row.enabled === 1,
    condition: safeJsonParse(row.condition_json, {}),
    action: safeJsonParse(row.action_json, {}),
    lastTriggered: row.last_triggered,
    createdAt: row.created_at,
  };
}

export default async function automationRoutes(fastify: FastifyInstance): Promise<void> {
  const projectParam = (request: { params: unknown }) =>
    (request.params as { projectId: string }).projectId;

  fastify.get(
    "/projects/:projectId/automations",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireProjectAccess(fastify.db, request.user!.userId, projectParam(request));
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const rows = fastify.db
        .prepare("SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC")
        .all(access.value.project.id) as Parameters<typeof serializeRow>[0][];
      return { automations: rows.map(serializeRow) };
    },
  );

  fastify.post(
    "/projects/:projectId/automations",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireProjectAccess(
        fastify.db,
        request.user!.userId,
        projectParam(request),
        "ADMIN",
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const parsed = AutomationBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      const db = fastify.db;
      // A device-scoped rule must target a device in this project.
      if (parsed.data.deviceId) {
        const device = db
          .prepare("SELECT device_id FROM devices WHERE device_id = ? AND project_id = ?")
          .get(parsed.data.deviceId, access.value.project.id);
        if (!device) return reply.code(400).send({ error: "invalid_device" });
      }
      const full = AutomationSchema.parse({
        ...parsed.data,
        projectId: access.value.project.id,
      });
      const id = randomUUID();
      const now = nowMs();
      db.prepare(
        `INSERT INTO automations
         (id, project_id, device_id, name, enabled, condition_json, action_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        access.value.project.id,
        full.deviceId ?? null,
        full.name,
        full.enabled ? 1 : 0,
        JSON.stringify(full.condition),
        JSON.stringify(full.action),
        now,
      );
      audit(db, `user:${request.user!.userId}`, "automation.created", {
        automationId: id,
        projectId: access.value.project.id,
        name: full.name,
      });
      const row = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as Parameters<
        typeof serializeRow
      >[0];
      return reply.code(201).send({ automation: serializeRow(row) });
    },
  );

  fastify.get(
    "/projects/:projectId/automations/:automationId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = request.params as { projectId: string; automationId: string };
      const access = requireProjectAccess(fastify.db, request.user!.userId, params.projectId);
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const row = fastify.db
        .prepare("SELECT * FROM automations WHERE id = ? AND project_id = ?")
        .get(params.automationId, access.value.project.id) as
        | Parameters<typeof serializeRow>[0]
        | undefined;
      if (!row) return reply.code(404).send({ error: "not_found" });
      return { automation: serializeRow(row) };
    },
  );

  fastify.put(
    "/projects/:projectId/automations/:automationId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = request.params as { projectId: string; automationId: string };
      const access = requireProjectAccess(
        fastify.db,
        request.user!.userId,
        params.projectId,
        "ADMIN",
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const db = fastify.db;
      const existing = db
        .prepare("SELECT id FROM automations WHERE id = ? AND project_id = ?")
        .get(params.automationId, access.value.project.id);
      if (!existing) return reply.code(404).send({ error: "not_found" });
      const parsed = AutomationBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      if (parsed.data.deviceId) {
        const device = db
          .prepare("SELECT device_id FROM devices WHERE device_id = ? AND project_id = ?")
          .get(parsed.data.deviceId, access.value.project.id);
        if (!device) return reply.code(400).send({ error: "invalid_device" });
      }
      const full = AutomationSchema.parse({ ...parsed.data, projectId: params.projectId });
      db.prepare(
        `UPDATE automations SET device_id = ?, name = ?, enabled = ?,
         condition_json = ?, action_json = ? WHERE id = ?`,
      ).run(
        full.deviceId ?? null,
        full.name,
        full.enabled ? 1 : 0,
        JSON.stringify(full.condition),
        JSON.stringify(full.action),
        params.automationId,
      );
      audit(db, `user:${request.user!.userId}`, "automation.updated", {
        automationId: params.automationId,
        projectId: params.projectId,
      });
      const row = db.prepare("SELECT * FROM automations WHERE id = ?").get(
        params.automationId,
      ) as Parameters<typeof serializeRow>[0];
      return { automation: serializeRow(row) };
    },
  );

  fastify.delete(
    "/projects/:projectId/automations/:automationId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = request.params as { projectId: string; automationId: string };
      const access = requireProjectAccess(
        fastify.db,
        request.user!.userId,
        params.projectId,
        "ADMIN",
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const deleted = fastify.db
        .prepare("DELETE FROM automations WHERE id = ? AND project_id = ?")
        .run(params.automationId, access.value.project.id).changes;
      if (deleted === 0) return reply.code(404).send({ error: "not_found" });
      audit(fastify.db, `user:${request.user!.userId}`, "automation.deleted", {
        automationId: params.automationId,
        projectId: params.projectId,
      });
      return { ok: true };
    },
  );

  fastify.get(
    "/projects/:projectId/automations/:automationId/runs",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = request.params as { projectId: string; automationId: string };
      const access = requireProjectAccess(fastify.db, request.user!.userId, params.projectId);
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
        .safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "invalid_request" });
      const automation = fastify.db
        .prepare("SELECT id FROM automations WHERE id = ? AND project_id = ?")
        .get(params.automationId, access.value.project.id);
      if (!automation) return reply.code(404).send({ error: "not_found" });
      const runs = (
        fastify.db
          .prepare(
            "SELECT id, at, detail_json FROM automation_runs WHERE automation_id = ? ORDER BY at DESC LIMIT ?",
          )
          .all(params.automationId, query.data.limit) as {
          id: string;
          at: number;
          detail_json: string;
        }[]
      ).map((r) => ({ id: r.id, at: r.at, detail: safeJsonParse(r.detail_json, {}) }));
      return { runs };
    },
  );
}
