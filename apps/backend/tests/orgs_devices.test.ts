import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  connectDevice,
  createDevice,
  createProject,
  deviceUsername,
  provisionDevice,
  registerUser,
  startTestServer,
  type ServerHandles,
} from "./helpers.js";

let server: ServerHandles;
let token: string;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  server = await startTestServer();
  const reg = await registerUser(server, "Org User", "orguser@example.com", "password123");
  token = reg.token;
  orgId = reg.org.id;
});

afterAll(async () => {
  await server.stop();
});

describe("orgs, projects, devices", () => {
  it("creates and lists orgs", async () => {
    const created = await api(server.httpUrl, token)("POST", "/api/orgs", {
      name: "Second Org",
    });
    expect(created.status).toBe(201);
    expect(created.json.org.name).toBe("Second Org");

    const listed = await api(server.httpUrl, token)("GET", "/api/orgs");
    expect(listed.status).toBe(200);
    expect(listed.json.orgs).toHaveLength(2);
    expect(listed.json.orgs.every((o: any) => o.role === "OWNER")).toBe(true);
  });

  it("creates and lists projects", async () => {
    const project = await createProject(server, token, orgId, "greenhouse");
    projectId = project.id;
    expect(project.name).toBe("greenhouse");

    const listed = await api(server.httpUrl, token)("GET", `/api/orgs/${orgId}/projects`);
    expect(listed.status).toBe(200);
    expect(listed.json.projects.map((p: any) => p.name)).toContain("greenhouse");
  });

  it("creates a device and returns one-time pairing credentials", async () => {
    const created = await createDevice(server, token, projectId, "thermostat-1");
    expect(created.device.deviceId).toMatch(/^DEV-[A-Z0-9]{7}$/);
    expect(created.pairing.deviceId).toBe(created.device.deviceId);
    expect(created.pairing.username).toBe(
      `device_${created.device.deviceId.replace("-", "")}`,
    );
    expect(created.pairing.password).toHaveLength(24);

    // Only the bcrypt hash is stored — never the plaintext password.
    const row = server.db
      .prepare("SELECT password_hash FROM pairings WHERE device_id_fk = ?")
      .get(created.device.deviceId) as { password_hash: string };
    expect(row.password_hash).not.toContain(created.pairing.password);
  });

  it("lists devices with status and capability counts", async () => {
    const listed = await api(server.httpUrl, token)(
      "GET",
      `/api/projects/${projectId}/devices`,
    );
    expect(listed.status).toBe(200);
    expect(listed.json.devices).toHaveLength(1);
    expect(listed.json.devices[0].status).toBe("OFFLINE");
    expect(listed.json.devices[0].capabilityCount).toBe(0);
  });

  it("returns device detail with capabilities, state, and health", async () => {
    const listed = await api(server.httpUrl, token)(
      "GET",
      `/api/projects/${projectId}/devices`,
    );
    const deviceId = listed.json.devices[0].deviceId;
    const detail = await api(server.httpUrl, token)("GET", `/api/devices/${deviceId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.device.deviceId).toBe(deviceId);
    expect(detail.json.capabilities).toEqual([]);
    expect(detail.json.state.desired).toEqual({});
    expect(detail.json.health).toBeNull();
  });

  it("rotates device credentials, returning the new token once", async () => {
    // First pair so there is an active credential to revoke.
    const { device } = await provisionDevice(server, "rotateuser", "rot-1");
    const rotated = await api(server.httpUrl, device.token)(
      "POST",
      `/api/devices/${device.deviceId}/credentials/rotate`,
    );
    expect(rotated.status).toBe(200);
    expect(rotated.json.deviceToken).toHaveLength(32);

    const rows = server.db
      .prepare("SELECT revoked_at FROM device_credentials WHERE device_id_fk = ?")
      .all(device.deviceId) as { revoked_at: number | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.revoked_at === null)).toHaveLength(1);
  });

  it("deletes a device and revokes its credentials", async () => {
    const { device } = await provisionDevice(server, "deleteuser", "del-1");
    const deleted = await api(server.httpUrl, device.token)(
      "DELETE",
      `/api/devices/${device.deviceId}`,
    );
    expect(deleted.status).toBe(200);

    const gone = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}`,
    );
    expect(gone.status).toBe(404);
    // Credential and pairing rows are removed by the delete cascade...
    const creds = server.db
      .prepare("SELECT id FROM device_credentials WHERE device_id_fk = ?")
      .all(device.deviceId) as unknown[];
    expect(creds).toHaveLength(0);
    const pairings = server.db
      .prepare("SELECT id FROM pairings WHERE device_id_fk = ?")
      .all(device.deviceId) as unknown[];
    expect(pairings).toHaveLength(0);
    // ...and the old device token no longer authenticates over MQTT.
    const conn = await connectDevice(
      server,
      deviceUsername(device.deviceId),
      device.deviceToken,
    ).then(
      () => "connected",
      () => "rejected",
    );
    expect(conn).toBe("rejected");
  });

  it("returns 404 for unknown devices and projects", async () => {
    const device = await api(server.httpUrl, token)("GET", "/api/devices/DEV-NOPE01");
    expect(device.status).toBe(404);
    const project = await api(server.httpUrl, token)("GET", "/api/projects/nope/devices");
    expect(project.status).toBe(404);
  });
});
