import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { accessDenied, requireDeviceAccess } from "../authz.js";
import { CommandError, sendCommand } from "../services/commands.js";
import { safeJsonParse } from "../util.js";

const CreateCommandSchema = z.object({
  capabilityId: z.string().min(1).max(64),
  action: z.string().min(1).max(64).default("set"),
  params: z.record(z.unknown()).default({}),
  ttlMs: z.number().int().positive().max(3_600_000).default(30_000),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export default async function commandRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/devices/:deviceId/commands",
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
      const parsed = CreateCommandSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      try {
        const command = await sendCommand(fastify.db, {
          deviceId: access.value.device.device_id,
          capabilityId: parsed.data.capabilityId,
          action: parsed.data.action,
          params: parsed.data.params as Record<string, unknown>,
          ttlMs: parsed.data.ttlMs,
          actor: `user:${request.user!.userId}`,
        });
        return reply.code(201).send({
          command: {
            commandId: command.command_id,
            deviceId: command.device_id_fk,
            capabilityId: command.capability_id,
            action: command.action,
            params: command.params,
            issuedAt: command.issued_at,
            expiresAt: command.expires_at,
            status: command.status,
          },
        });
      } catch (err) {
        if (err instanceof CommandError) {
          return reply.code(err.statusCode).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  fastify.get(
    "/devices/:deviceId/commands",
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
      const query = ListQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "invalid_request" });
      const rows = fastify.db
        .prepare(
          `SELECT c.*, r.status AS result_status, r.reason AS result_reason,
                  r.reported_state_json AS result_reported_state, r.at AS result_at
           FROM commands c LEFT JOIN command_results r ON r.command_id = c.command_id
           WHERE c.device_id_fk = ? ORDER BY c.issued_at DESC LIMIT ?`,
        )
        .all(access.value.device.device_id, query.data.limit) as {
        command_id: string;
        capability_id: string;
        action: string;
        params_json: string;
        issued_at: number;
        expires_at: number;
        status: string;
        created_by: string;
        result_status: string | null;
        result_reason: string | null;
        result_reported_state: string | null;
        result_at: number | null;
      }[];
      return {
        commands: rows.map((r) => ({
          commandId: r.command_id,
          capabilityId: r.capability_id,
          action: r.action,
          params: safeJsonParse(r.params_json, {}),
          issuedAt: r.issued_at,
          expiresAt: r.expires_at,
          status: r.status,
          createdBy: r.created_by,
          result: r.result_status
            ? {
                status: r.result_status,
                reason: r.result_reason,
                reportedState: r.result_reported_state
                  ? safeJsonParse(r.result_reported_state, {})
                  : undefined,
                at: r.result_at,
              }
            : null,
        })),
      };
    },
  );
}
