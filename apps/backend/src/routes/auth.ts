import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { LoginRequestSchema, RegisterRequestSchema } from "@aiot/contracts";
import { requireAuth } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { isFirebaseEnabled, verifyFirebaseToken } from "../auth/firebase.js";
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

  // Pluggable Firebase auth: exchange a verified Firebase ID token for a
  // local JWT of the same shape as /auth/login. find-or-create resolution:
  //   1. federated_identities link (provider='firebase', provider_uid=uid)
  //   2. existing local user with the same email (then create the link)
  //   3. brand-new local user with a random unusable password + link row
  fastify.post("/auth/firebase", strictLimit, async (request, reply) => {
    if (!isFirebaseEnabled()) {
      return reply.code(501).send({ error: "firebase_auth_disabled" });
    }
    const body = request.body as { idToken?: unknown } | undefined;
    const idToken = body?.idToken;
    if (typeof idToken !== "string" || idToken.length === 0) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    let verified;
    try {
      verified = await verifyFirebaseToken(idToken);
    } catch (err) {
      // Never log the raw token or credential material.
      if (err instanceof Error && err.message.includes("not installed")) {
        return reply.code(500).send({ error: "firebase_misconfigured" });
      }
      return reply.code(401).send({ error: "invalid_firebase_token" });
    }
    const db = fastify.db;
    const now = nowMs();
    type LocalUser = { id: string; email: string; name: string };
    const byId = (id: string) =>
      db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(id) as
        | LocalUser
        | undefined;

    let user: LocalUser | undefined;
    const link = db
      .prepare(
        "SELECT user_id FROM federated_identities WHERE provider = 'firebase' AND provider_uid = ?",
      )
      .get(verified.uid) as { user_id: string } | undefined;
    if (link) {
      user = byId(link.user_id);
    }
    if (!user && verified.email) {
      const email = verified.email.toLowerCase();
      user = db.prepare("SELECT id, email, name FROM users WHERE email = ?").get(
        email,
      ) as LocalUser | undefined;
      if (user) {
        db.prepare(
          "INSERT INTO federated_identities (id, user_id, provider, provider_uid, created_at) VALUES (?, ?, 'firebase', ?, ?)",
        ).run(randomUUID(), user.id, verified.uid, now);
      }
    }
    if (!user) {
      if (!verified.email) {
        return reply.code(400).send({ error: "firebase_email_missing" });
      }
      const email = verified.email.toLowerCase();
      const name = verified.name?.trim() || email.split("@")[0];
      const userId = randomUUID();
      const orgId = randomUUID();
      const orgName = `${name}'s workspace`;
      // Random unusable local password: this account can only sign in via Firebase.
      const unusableHash = hashPassword(`${randomUUID()}:${randomUUID()}`);
      db.transaction(() => {
        db.prepare(
          "INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(userId, email, unusableHash, name, now);
        db.prepare("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)").run(
          orgId,
          orgName,
          now,
        );
        db.prepare(
          "INSERT INTO memberships (id, org_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)",
        ).run(randomUUID(), orgId, userId, now);
        db.prepare(
          "INSERT INTO federated_identities (id, user_id, provider, provider_uid, created_at) VALUES (?, ?, 'firebase', ?, ?)",
        ).run(randomUUID(), userId, verified.uid, now);
      })();
      audit(db, `user:${userId}`, "user.registered", {
        userId,
        orgId,
        via: "firebase",
      });
      user = { id: userId, email, name };
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

  fastify.get("/auth/me", { preHandler: [requireAuth] }, async (request, reply) => {    const db = fastify.db;
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
