import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UserRoleSchema } from "@aiot/contracts";
import { requireAuth } from "../auth/middleware.js";
import { accessDenied, getUserOrgs, requireOrgAccess } from "../authz.js";
import { audit } from "../services/audit.js";
import { nowMs } from "../util.js";

const NameSchema = z.object({ name: z.string().min(1).max(200) });
const MemberSchema = z.object({ email: z.string().email(), role: UserRoleSchema });

export default async function orgRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/orgs", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = NameSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const db = fastify.db;
    const orgId = randomUUID();
    const now = nowMs();
    db.transaction(() => {
      db.prepare("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)").run(
        orgId,
        parsed.data.name,
        now,
      );
      db.prepare(
        "INSERT INTO memberships (id, org_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)",
      ).run(randomUUID(), orgId, request.user!.userId, now);
    })();
    audit(db, `user:${request.user!.userId}`, "org.created", {
      orgId,
      name: parsed.data.name,
    });
    return reply
      .code(201)
      .send({ org: { id: orgId, name: parsed.data.name, createdAt: now } });
  });

  fastify.get("/orgs", { preHandler: [requireAuth] }, async (request) => {
    return {
      orgs: getUserOrgs(fastify.db, request.user!.userId).map((m) => ({
        id: m.orgId,
        name: m.orgName,
        role: m.role,
      })),
    };
  });

  fastify.post(
    "/orgs/:orgId/members",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireOrgAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { orgId: string }).orgId,
        "ADMIN",
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const parsed = MemberSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      const db = fastify.db;
      const target = db
        .prepare("SELECT id FROM users WHERE email = ?")
        .get(parsed.data.email.toLowerCase()) as { id: string } | undefined;
      if (!target) return reply.code(404).send({ error: "user_not_found" });
      const orgId = access.value.org.id;
      const existing = db
        .prepare("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?")
        .get(orgId, target.id) as { role: string } | undefined;
      // Never demote the last OWNER.
      if (existing?.role === "OWNER" && parsed.data.role !== "OWNER") {
        const owners = (
          db
            .prepare("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'OWNER'")
            .get(orgId) as { n: number }
        ).n;
        if (owners <= 1) return reply.code(400).send({ error: "last_owner" });
      }
      const now = nowMs();
      db.prepare(
        `INSERT INTO memberships (id, org_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role`,
      ).run(randomUUID(), orgId, target.id, parsed.data.role, now);
      audit(db, `user:${request.user!.userId}`, "org.member_added", {
        orgId,
        userId: target.id,
        role: parsed.data.role,
      });
      return { ok: true, orgId, userId: target.id, role: parsed.data.role };
    },
  );

  fastify.get(
    "/orgs/:orgId/projects",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireOrgAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { orgId: string }).orgId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const projects = (
        fastify.db
          .prepare("SELECT id, name, created_at FROM projects WHERE org_id = ? ORDER BY name")
          .all(access.value.org.id) as { id: string; name: string; created_at: number }[]
      ).map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at }));
      return { projects };
    },
  );

  fastify.post(
    "/orgs/:orgId/projects",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const access = requireOrgAccess(
        fastify.db,
        request.user!.userId,
        (request.params as { orgId: string }).orgId,
      );
      if (!access.ok) {
        const denied = accessDenied(access);
        return reply.code(denied.status).send(denied.body);
      }
      const parsed = NameSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      const projectId = randomUUID();
      const now = nowMs();
      fastify.db
        .prepare("INSERT INTO projects (id, org_id, name, created_at) VALUES (?, ?, ?, ?)")
        .run(projectId, access.value.org.id, parsed.data.name, now);
      audit(fastify.db, `user:${request.user!.userId}`, "project.created", {
        projectId,
        orgId: access.value.org.id,
        name: parsed.data.name,
      });
      return reply.code(201).send({
        project: {
          id: projectId,
          orgId: access.value.org.id,
          name: parsed.data.name,
          createdAt: now,
        },
      });
    },
  );
}
