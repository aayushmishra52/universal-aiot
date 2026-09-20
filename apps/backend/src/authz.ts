import type { Database } from "better-sqlite3";
import { UserRoleSchema, type UserRole } from "@aiot/contracts";

const ROLE_RANK: Record<UserRole, number> = {
  VIEWER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export interface OrgMembership {
  orgId: string;
  orgName: string;
  role: UserRole;
}

/** All organizations a user belongs to, with their role in each. */
export function getUserOrgs(db: Database, userId: string): OrgMembership[] {
  const rows = db
    .prepare(
      `SELECT m.org_id AS orgId, o.name AS orgName, m.role AS role
       FROM memberships m JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = ? ORDER BY o.name`,
    )
    .all(userId) as { orgId: string; orgName: string; role: string }[];
  return rows.map((r) => ({
    orgId: r.orgId,
    orgName: r.orgName,
    role: UserRoleSchema.parse(r.role),
  }));
}

/** The user's role in an org, or null when they are not a member. */
export function getOrgRole(
  db: Database,
  userId: string,
  orgId: string,
): UserRole | null {
  const row = db
    .prepare("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?")
    .get(orgId, userId) as { role: string } | undefined;
  if (!row) return null;
  return UserRoleSchema.parse(row.role);
}

export type AccessResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "forbidden" };

export interface OrgAccess {
  org: { id: string; name: string };
  role: UserRole;
}

/** Resolve an org the user may access; 404 when missing/not a member, 403 on weak role. */
export function requireOrgAccess(
  db: Database,
  userId: string,
  orgId: string,
  minRole: UserRole = "VIEWER",
): AccessResult<OrgAccess> {
  const org = db
    .prepare("SELECT id, name FROM organizations WHERE id = ?")
    .get(orgId) as { id: string; name: string } | undefined;
  if (!org) return { ok: false, reason: "not_found" };
  const role = getOrgRole(db, userId, orgId);
  if (!role) return { ok: false, reason: "not_found" };
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) return { ok: false, reason: "forbidden" };
  return { ok: true, value: { org, role } };
}

export interface ProjectAccess {
  project: { id: string; org_id: string; name: string };
  orgId: string;
  role: UserRole;
}

/** Resolve a project via org membership; same 404/403 semantics. */
export function requireProjectAccess(
  db: Database,
  userId: string,
  projectId: string,
  minRole: UserRole = "VIEWER",
): AccessResult<ProjectAccess> {
  const project = db
    .prepare("SELECT id, org_id, name FROM projects WHERE id = ?")
    .get(projectId) as { id: string; org_id: string; name: string } | undefined;
  if (!project) return { ok: false, reason: "not_found" };
  const orgAccess = requireOrgAccess(db, userId, project.org_id, minRole);
  if (!orgAccess.ok) return orgAccess;
  return {
    ok: true,
    value: { project, orgId: project.org_id, role: orgAccess.value.role },
  };
}

export interface DeviceAccess {
  device: DeviceRow;
  orgId: string;
  projectId: string;
  role: UserRole;
}

export interface DeviceRow {
  id: string;
  device_id: string;
  project_id: string;
  org_id: string;
  name: string;
  type: string | null;
  model: string | null;
  firmware_version: string | null;
  protocol_version: string | null;
  status: string;
  last_seen: number | null;
  created_at: number;
}

/** Resolve a device via device -> project -> org membership. */
export function requireDeviceAccess(
  db: Database,
  userId: string,
  deviceId: string,
  minRole: UserRole = "VIEWER",
): AccessResult<DeviceAccess> {
  const device = db
    .prepare("SELECT * FROM devices WHERE device_id = ?")
    .get(deviceId) as DeviceRow | undefined;
  if (!device) return { ok: false, reason: "not_found" };
  const role = getOrgRole(db, userId, device.org_id);
  // Not a member: 404 to avoid leaking device existence across orgs.
  if (!role) return { ok: false, reason: "not_found" };
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) return { ok: false, reason: "forbidden" };
  return {
    ok: true,
    value: { device, orgId: device.org_id, projectId: device.project_id, role },
  };
}

/** Map an AccessResult failure to the right HTTP status + body. */
export function accessDenied(
  result: { ok: false; reason: "not_found" | "forbidden" },
): { status: number; body: { error: string } } {
  return result.reason === "not_found"
    ? { status: 404, body: { error: "not_found" } }
    : { status: 403, body: { error: "forbidden" } };
}
