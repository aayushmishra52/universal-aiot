import { randomUUID } from "node:crypto";
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
import { hashPassword } from "../src/auth/password.js";

let server: ServerHandles;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

describe("pairing", () => {
  it("pairs with valid credentials and returns a one-time device token", async () => {
    const reg = await registerUser(server, "Pair User", "pair@example.com", "password123");
    const project = await createProject(server, reg.token, reg.org.id, "pair-proj");
    const created = await createDevice(server, reg.token, project.id, "pair-dev");

    const res = await api(server.httpUrl, reg.token)("POST", "/api/pair", {
      deviceId: created.pairing.deviceId,
      username: created.pairing.username,
      password: created.pairing.password,
    });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.rotated).toBe(true);
    expect(res.json.deviceId).toBe(created.pairing.deviceId);
    expect(res.json.projectId).toBe(project.id);
    expect(res.json.orgId).toBe(reg.org.id);
    expect(res.json.deviceToken).toHaveLength(32);

    // The issued token authenticates against the MQTT broker.
    const client = await connectDevice(
      server,
      deviceUsername(created.pairing.deviceId),
      res.json.deviceToken,
    );
    await client.endAsync();
  });

  it("rejects reuse of the pairing password after it was consumed", async () => {
    const reg = await registerUser(server, "Reuse User", "reuse@example.com", "password123");
    const project = await createProject(server, reg.token, reg.org.id, "reuse-proj");
    const created = await createDevice(server, reg.token, project.id, "reuse-dev");

    const first = await api(server.httpUrl, reg.token)("POST", "/api/pair", {
      deviceId: created.pairing.deviceId,
      username: created.pairing.username,
      password: created.pairing.password,
    });
    expect(first.status).toBe(200);

    const second = await api(server.httpUrl, reg.token)("POST", "/api/pair", {
      deviceId: created.pairing.deviceId,
      username: created.pairing.username,
      password: created.pairing.password,
    });
    expect(second.status).toBe(404);
  });

  it("rejects a wrong pairing password with 401", async () => {
    const reg = await registerUser(server, "Wrong User", "wrong@example.com", "password123");
    const project = await createProject(server, reg.token, reg.org.id, "wrong-proj");
    const created = await createDevice(server, reg.token, project.id, "wrong-dev");

    const res = await api(server.httpUrl, reg.token)("POST", "/api/pair", {
      deviceId: created.pairing.deviceId,
      username: created.pairing.username,
      password: "not-the-password",
    });
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("invalid_credentials");
  });

  it("rejects expired pairings", async () => {
    const { project, device } = await provisionDevice(server, "expireduser", "exp-1");
    // Insert an expired pairing row directly.
    const row = server.db
      .prepare("SELECT device_id FROM devices WHERE project_id = ?")
      .get(project.id) as { device_id: string };
    server.db
      .prepare(
        `INSERT INTO pairings (id, device_id_fk, username, password_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        row.device_id,
        "expired_user",
        hashPassword("expired-pass"),
        Date.now() - 1000,
        Date.now(),
      );

    const res = await api(server.httpUrl, device.token)("POST", "/api/pair", {
      deviceId: row.device_id,
      username: "expired_user",
      password: "expired-pass",
    });
    expect(res.status).toBe(404);
  });

  it("does not let a user pair a device from another user's org", async () => {
    const a = await provisionDevice(server, "pairA", "pair-a-dev");
    const b = await registerUser(server, "Pair B", "pairb@example.com", "password123");

    // Fresh pairing row for A's device, then attempt pairing as B.
    const created = await createDevice(server, a.device.token, a.project.id, "pair-a-dev2");
    const res = await api(server.httpUrl, b.token)("POST", "/api/pair", {
      deviceId: created.pairing.deviceId,
      username: created.pairing.username,
      password: created.pairing.password,
    });
    expect(res.status).toBe(404);
  });

  it("validates the pairing request body", async () => {
    const reg = await registerUser(server, "Valid User", "valid@example.com", "password123");
    const res = await api(server.httpUrl, reg.token)("POST", "/api/pair", {
      deviceId: "not-a-device-id",
    });
    expect(res.status).toBe(400);
  });
});
