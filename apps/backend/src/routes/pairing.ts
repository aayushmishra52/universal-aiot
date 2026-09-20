import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PairingRequestSchema } from "@aiot/contracts";
import { requireAuth } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { getOrgRole } from "../authz.js";
import { audit } from "../services/audit.js";
import { nowMs, pairingUsernameFor, randomAlnum } from "../util.js";

/**
 * Device pairing: exchanges a one-time pairing credential for an operational
 * device token. The pairing row is marked used and any previous device
 * credential is revoked, so the old pairing password stops working.
 */
export default async function pairingRoutes(fastify: FastifyInstance): Promise<void> {
  const strictLimit = {
    config: {
      rateLimit: {
        max: fastify.config.rateLimitAuthPerMin,
        timeWindow: "1 minute",
      },
    },
  };

  fastify.post("/pair", { preHandler: [requireAuth], ...strictLimit }, async (request, reply) => {
    const parsed = PairingRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { deviceId, username, password } = parsed.data;
    const db = fastify.db;
    const now = nowMs();

    const pairing = db
      .prepare(
        `SELECT p.id AS id, p.password_hash AS password_hash,
                p.device_id_fk AS device_id, d.project_id AS project_id, d.org_id AS org_id
         FROM pairings p JOIN devices d ON d.device_id = p.device_id_fk
         WHERE p.device_id_fk = ? AND p.username = ?
           AND p.used_at IS NULL AND p.revoked_at IS NULL AND p.expires_at > ?`,
      )
      .get(deviceId, username, now) as
      | {
          id: string;
          password_hash: string;
          device_id: string;
          project_id: string;
          org_id: string;
        }
      | undefined;
    // 404 (not 401/403) for unknown/used/expired pairings to avoid enumeration.
    if (!pairing) return reply.code(404).send({ error: "not_found" });

    // The device must live in one of the caller's orgs.
    if (!getOrgRole(db, request.user!.userId, pairing.org_id)) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (!verifyPassword(password, pairing.password_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    // Rotate: issue a fresh device token (shown once), revoke previous
    // credentials, and mark the pairing row used in one transaction.
    const deviceToken = randomAlnum(32);
    const credentialUsername = pairingUsernameFor(deviceId);
    db.transaction(() => {
      db.prepare("UPDATE pairings SET used_at = ? WHERE id = ?").run(now, pairing.id);
      db.prepare(
        "UPDATE device_credentials SET revoked_at = ? WHERE device_id_fk = ? AND revoked_at IS NULL",
      ).run(now, deviceId);
      db.prepare(
        `INSERT INTO device_credentials (id, device_id_fk, username, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), deviceId, credentialUsername, hashPassword(deviceToken), now);
    })();
    audit(db, `user:${request.user!.userId}`, "device.paired", {
      deviceId,
      projectId: pairing.project_id,
      orgId: pairing.org_id,
    });
    return {
      ok: true,
      deviceId,
      projectId: pairing.project_id,
      orgId: pairing.org_id,
      rotated: true,
      deviceToken,
    };
  });
}
