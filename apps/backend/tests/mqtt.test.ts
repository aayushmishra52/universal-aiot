import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  connectDevice,
  createDevice,
  createProject,
  deviceUsername,
  provisionDevice,
  publishManifest,
  publishTelemetry,
  registerUser,
  startTestServer,
  waitFor,
  type ServerHandles,
} from "./helpers.js";
import { topicTelemetry } from "@aiot/contracts";

let server: ServerHandles;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

describe("mqtt ingest", () => {
  it("authenticates with pairing credentials and rejects bad ones", async () => {
    const reg = await registerUser(server, "Auth User", "authuser@example.com", "password123");
    const project = await createProject(server, reg.token, reg.org.id, "auth-proj");
    const created = await createDevice(server, reg.token, project.id, "auth-dev");

    // Unused pairing credentials authenticate.
    const withPairing = await connectDevice(
      server,
      created.pairing.username,
      created.pairing.password,
    );
    await withPairing.endAsync();

    // Unknown credentials are rejected.
    const evil = await connectDevice(server, "nope", "nope").then(
      () => "connected",
      () => "rejected",
    );
    expect(evil).toBe("rejected");
  });

  it("ingests manifest + telemetry into the database and API", async () => {
    const { device } = await provisionDevice(server, "mqttuser", "mqtt-1");
    const client = await connectDevice(
      server,
      deviceUsername(device.deviceId),
      device.deviceToken,
    );

    await publishManifest(client, device.orgId, device.projectId, device.deviceId);
    await publishTelemetry(client, device.orgId, device.projectId, device.deviceId, {
      temp: 21.5,
      fan: false,
    });

    await waitFor(async () => {
      const detail = await api(server.httpUrl, device.token)(
        "GET",
        `/api/devices/${device.deviceId}`,
      );
      return (
        detail.status === 200 &&
        detail.json.capabilities.length === 2 &&
        detail.json.device.status === "ONLINE"
      );
    });

    const detail = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}`,
    );
    const ids = detail.json.capabilities.map((c: any) => c.id).sort();
    expect(ids).toEqual(["fan", "temp"]);
    expect(detail.json.device.model).toBe("T-1000");
    expect(detail.json.device.firmwareVersion).toBe("1.2.3");

    const telemetry = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}/telemetry`,
      undefined,
      { limit: "10" },
    );
    expect(telemetry.status).toBe(200);
    expect(telemetry.json.telemetry).toHaveLength(1);
    expect(telemetry.json.telemetry[0].values.temp).toBe(21.5);

    // Capability filter.
    const filtered = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}/telemetry`,
      undefined,
      { capability: "temp", limit: "10" },
    );
    expect(filtered.json.telemetry).toHaveLength(1);
    const missing = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}/telemetry`,
      undefined,
      { capability: "humidity", limit: "10" },
    );
    expect(missing.json.telemetry).toHaveLength(0);

    await client.endAsync();
  });

  it("dedupes telemetry by message_id", async () => {
    const { device } = await provisionDevice(server, "mqttdup", "mqtt-dup");
    const client = await connectDevice(
      server,
      deviceUsername(device.deviceId),
      device.deviceToken,
    );
    const messageId = "dup-message-1";
    await publishTelemetry(
      client,
      device.orgId,
      device.projectId,
      device.deviceId,
      { temp: 22 },
      messageId,
    );
    await publishTelemetry(
      client,
      device.orgId,
      device.projectId,
      device.deviceId,
      { temp: 22 },
      messageId,
    );

    await waitFor(async () => {
      const t = await api(server.httpUrl, device.token)(
        "GET",
        `/api/devices/${device.deviceId}/telemetry`,
        undefined,
        { limit: "10" },
      );
      return t.json.telemetry.length === 1;
    });
    // Give the duplicate a chance to (incorrectly) insert.
    await new Promise((r) => setTimeout(r, 400));
    const rows = server.db
      .prepare("SELECT COUNT(*) AS n FROM telemetry WHERE device_id_fk = ?")
      .get(device.deviceId) as { n: number };
    expect(rows.n).toBe(1);
    await client.endAsync();
  });

  it("ignores malformed payloads without crashing the broker", async () => {
    const { device } = await provisionDevice(server, "mqttbad", "mqtt-bad");
    const client = await connectDevice(
      server,
      deviceUsername(device.deviceId),
      device.deviceToken,
    );
    await client.publishAsync(
      topicTelemetry(device.orgId, device.projectId, device.deviceId),
      "this is not json{{{",
      { qos: 1 },
    );
    await client.publishAsync(
      topicTelemetry(device.orgId, device.projectId, device.deviceId),
      JSON.stringify({ protocolVersion: "9.9", bogus: true }),
      { qos: 1 },
    );
    await new Promise((r) => setTimeout(r, 400));
    const rows = server.db
      .prepare("SELECT COUNT(*) AS n FROM telemetry WHERE device_id_fk = ?")
      .get(device.deviceId) as { n: number };
    expect(rows.n).toBe(0);

    // The broker still works afterwards.
    await publishTelemetry(client, device.orgId, device.projectId, device.deviceId, {
      temp: 20,
    });
    await waitFor(async () => {
      const n = (
        server.db
          .prepare("SELECT COUNT(*) AS n FROM telemetry WHERE device_id_fk = ?")
          .get(device.deviceId) as { n: number }
      ).n;
      return n === 1;
    });
    await client.endAsync();
  });

  it("tracks presence and health", async () => {
    const { device } = await provisionDevice(server, "mqttph", "mqtt-ph");
    const client = await connectDevice(
      server,
      deviceUsername(device.deviceId),
      device.deviceToken,
    );
    const { topicPresence, topicHealth, PROTOCOL_VERSION } = await import("@aiot/contracts");
    await client.publishAsync(
      topicPresence(device.orgId, device.projectId, device.deviceId),
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        deviceId: device.deviceId,
        online: true,
        at: Date.now(),
      }),
      { qos: 1 },
    );
    await client.publishAsync(
      topicHealth(device.orgId, device.projectId, device.deviceId),
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        deviceId: device.deviceId,
        uptime: 123,
        mqtt: "connected",
        firmware: "1.2.3",
        sensorErrors: 0,
        capabilityHealth: { temp: "good" },
        at: Date.now(),
      }),
      { qos: 1 },
    );

    await waitFor(async () => {
      const detail = await api(server.httpUrl, device.token)(
        "GET",
        `/api/devices/${device.deviceId}`,
      );
      return (
        detail.json.device.status === "ONLINE" && detail.json.health?.uptime === 123
      );
    });
    await client.endAsync();
  });
});
