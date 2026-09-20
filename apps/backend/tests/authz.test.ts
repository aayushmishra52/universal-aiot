import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  provisionDevice,
  registerUser,
  startTestServer,
  type ServerHandles,
} from "./helpers.js";

let server: ServerHandles;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

describe("authorization", () => {
  it("hides another user's device (404) from non-members", async () => {
    const a = await provisionDevice(server, "authzA", "authz-a-dev");
    const b = await registerUser(server, "Authz B", "authzb@example.com", "password123");

    const device = await api(server.httpUrl, b.token)(
      "GET",
      `/api/devices/${a.device.deviceId}`,
    );
    expect(device.status).toBe(404);

    const telemetry = await api(server.httpUrl, b.token)(
      "GET",
      `/api/devices/${a.device.deviceId}/telemetry`,
    );
    expect(telemetry.status).toBe(404);

    const command = await api(server.httpUrl, b.token)(
      "POST",
      `/api/devices/${a.device.deviceId}/commands`,
      { capabilityId: "fan", params: { value: true } },
    );
    expect(command.status).toBe(404);

    const projects = await api(server.httpUrl, b.token)(
      "GET",
      `/api/orgs/${a.org.id}/projects`,
    );
    expect(projects.status).toBe(404);
    void a;
  });

  it("lets a VIEWER read but not write", async () => {
    const a = await provisionDevice(server, "authzC", "authz-c-dev");
    const b = await registerUser(server, "Authz D", "authzd@example.com", "password123");

    const added = await api(server.httpUrl, a.device.token)(
      "POST",
      `/api/orgs/${a.org.id}/members`,
      { email: "authzd@example.com", role: "VIEWER" },
    );
    expect(added.status).toBe(200);
    void b;

    // VIEWER can read the device...
    const device = await api(server.httpUrl, b.token)(
      "GET",
      `/api/devices/${a.device.deviceId}`,
    );
    expect(device.status).toBe(200);

    // ...but cannot issue commands (403), delete, or rotate credentials.
    const command = await api(server.httpUrl, b.token)(
      "POST",
      `/api/devices/${a.device.deviceId}/commands`,
      { capabilityId: "fan", params: { value: true } },
    );
    expect(command.status).toBe(403);
    expect(command.json.error).toBe("forbidden");

    const del = await api(server.httpUrl, b.token)(
      "DELETE",
      `/api/devices/${a.device.deviceId}`,
    );
    expect(del.status).toBe(403);

    const rotate = await api(server.httpUrl, b.token)(
      "POST",
      `/api/devices/${a.device.deviceId}/credentials/rotate`,
    );
    expect(rotate.status).toBe(403);

    const automation = await api(server.httpUrl, b.token)(
      "POST",
      `/api/projects/${a.project.id}/automations`,
      {
        name: "x",
        condition: { capabilityId: "temp", operator: ">", value: 30 },
        action: { capabilityId: "fan", action: "set", params: { value: true } },
      },
    );
    expect(automation.status).toBe(403);
  });

  it("lets an ADMIN delete devices", async () => {
    const a = await provisionDevice(server, "authzE", "authz-e-dev");
    const b = await registerUser(server, "Authz F", "authzf@example.com", "password123");

    await api(server.httpUrl, a.device.token)("POST", `/api/orgs/${a.org.id}/members`, {
      email: "authzf@example.com",
      role: "ADMIN",
    });

    const del = await api(server.httpUrl, b.token)(
      "DELETE",
      `/api/devices/${a.device.deviceId}`,
    );
    expect(del.status).toBe(200);
  });

  it("prevents non-admins from adding org members", async () => {
    const a = await provisionDevice(server, "authzG", "authz-g-dev");
    const b = await registerUser(server, "Authz H", "authzh@example.com", "password123");
    const c = await registerUser(server, "Authz I", "authzi@example.com", "password123");

    await api(server.httpUrl, a.device.token)("POST", `/api/orgs/${a.org.id}/members`, {
      email: "authzh@example.com",
      role: "VIEWER",
    });

    const attempt = await api(server.httpUrl, b.token)(
      "POST",
      `/api/orgs/${a.org.id}/members`,
      { email: "authzi@example.com", role: "VIEWER" },
    );
    expect(attempt.status).toBe(403);
    void c;
  });
});
