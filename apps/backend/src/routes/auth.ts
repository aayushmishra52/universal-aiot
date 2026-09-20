import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { LoginRequestSchema, RegisterRequestSchema } from "@aiot/contracts";
import { requireAuth } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { signToken } from "../auth/jwt.js";
import { getUserOrgs } from "../authz.js";
import { audit } from "../services/audit.js";
import { nowMs } from "../util.js";

function issueToken(fastify: FastifyInstance, userId: string, email: string): string {
  return signToken(
    { sub: userId, email },
    fastify.config.jwtSecret,
    fastify.config.jwtExpiresIn,
  );
}

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const strictLimit = {
    config: {
      rateLimit: {
        max: fastify.config.rateLimitAuthPerMin,
        timeWindow: "1 minute",
      },
    },
  };

  fastify.post("/auth/register", strictLimit, async (request, reply) => {
    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const db = fastify.db;
    const email = parsed.data.email.toLowerCase();
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return reply.code(409).send({ error: "email_taken" });
    }
    const userId = randomUUID();
    const orgId = randomUUID();
    const orgName = `${parsed.data.name}'s workspace`;
    const now = nowMs();
    db.transaction(() => {
      db.prepare(
        "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(userId, email, hashPassword(parsed.data.password), parsed.data.name, now);
      db.prepare("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)").run(
        orgId,
        orgName,
        now,
      );
      db.prepare(
        "INSERT INTO memberships (id, org_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)",
      ).run(randomUUID(), orgId, userId, now);
    })();
    audit(db, `user:${userId}`, "user.registered", { userId, orgId });
    return reply.code(201).send({
      token: issueToken(fastify, userId, email),
      user: { id: userId, email, name: parsed.data.name },
      org: { id: orgId, name: orgName },
    });
  });

  fastify.post("/auth/login", strictLimit, async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const db = fastify.db;
    const email = parsed.data.email.toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
      | { id: string; email: string; password_hash: string; name: string }
      | undefined;
    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const orgs = getUserOrgs(db, user.id).map((m) => ({
      id: m.orgId,
      name: m.orgName,
      role: m.role,
    }));
    return {
      token: issueToken(fastify, user.id, user.email),
      user: { id: user.id, email: user.email, name: user.name },
      orgs,
    };
  });

  fastify.get("/auth/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const db = fastify.db;
    const userId = request.user!.userId;
    const user = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(userId) as
      | { id: string; email: string; name: string }
      | undefined;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return {
      user,
      orgs: getUserOrgs(db, userId).map((m) => ({
        id: m.orgId,
        name: m.orgName,
        role: m.role,
      })),
    };
  });
}
