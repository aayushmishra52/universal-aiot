import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mqtt from "mqtt";
import {
  api,
  commandTopic,
  connectDevice,
  deviceUsername,
  provisionDevice,
  publishManifest,
  sleep,
  startTestServer,
  waitFor,
  type ServerHandles,
  type TestDevice,
} from "./helpers.js";
import { PROTOCOL_VERSION } from "@aiot/contracts";
import { sweepExpiredCommands } from "../src/services/sweeper.js";

let server: ServerHandles;
let device: TestDevice;
let fake: mqtt.MqttClient;
const receivedCommands: any[] = [];

async function setupDevice(): Promise<void> {
  const provisioned = await provisionDevice(server, "cmduser", "cmd-1");
  device = provisioned.device;
  fake = await connectDevice(server, deviceUsername(device.deviceId), device.deviceToken);
  await fake.subscribeAsync(commandTopic(device.orgId, device.projectId, device.deviceId));
  fake.on("message", (topic, payload) => {
    receivedCommands.push(JSON.parse(payload.toString()));
  });
  await publishManifest(fake, device.orgId, device.projectId, device.deviceId);
  await waitFor(async () => {
    const detail = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}`,
    );
    return detail.json.capabilities.length === 2;
  });
}

function publishResult(commandId: string, status: string, reportedState?: Record<string, unknown>) {
  return fake.publishAsync(
    commandTopic(device.orgId, device.projectId, device.deviceId),
    JSON.stringify({
      kind: "result",
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      deviceId: device.deviceId,
      status,
      ...(reportedState ? { reportedState } : {}),
      at: Date.now(),
    }),
    { qos: 1 },
  );
}

beforeAll(async () => {
  server = await startTestServer();
  await setupDevice();
});

afterAll(async () => {
  await fake?.endAsync();
  await server.stop();
});

describe("commands", () => {
  it("rejects commands with invalid parameters", async () => {
    const badType = await api(server.httpUrl, device.token)(
      "POST",
      `/api/devices/${device.deviceId}/commands`,
      { capabilityId: "fan", params: { value: "banana" } },
    );
    expect(badType.status).toBe(400);
    expect(badType.json.error).toBe("invalid_parameter");

    const notActuator = await api(server.httpUrl, device.token)(
      "POST",
      `/api/devices/${device.deviceId}/commands`,
      { capabilityId: "temp", params: { value: 25 } },
    );
    expect(notActuator.status).toBe(400);
    expect(notActuator.json.error).toBe("invalid_capability");

    const unknown = await api(server.httpUrl, device.token)(
      "POST",
      `/api/devices/${device.deviceId}/commands`,
      { capabilityId: "nope", params: {} },
    );
    expect(unknown.status).toBe(400);
  });

  it("completes a full command round-trip with a fake device", async () => {
    receivedCommands.length = 0;
    const res = await api(server.httpUrl, device.token)(
      "POST",
      `/api/devices/${device.deviceId}/commands`,
      { capabilityId: "fan", action: "set", params: { value: true } },
    );
    expect(res.status).toBe(201);
    const commandId = res.json.command.commandId;
    expect(res.json.command.status).toBe("SENT");

    // The fake device receives the command over MQTT...
    await waitFor(() =>
      receivedCommands.some((c) => c.commandId === commandId && c.kind === "command"),
    );
    const wire = receivedCommands.find((c) => c.commandId === commandId);
    expect(wire.kind).toBe("command");
    expect(wire.protocolVersion).toBe("1.0");
    expect(wire.capabilityId).toBe("fan");

    // ...acknowledges, then reports success with its new state.
    await publishResult(commandId, "ACKNOWLEDGED");
    await waitFor(async () => {
      const list = await api(server.httpUrl, device.token)(
        "GET",
        `/api/devices/${device.deviceId}/commands`,
        undefined,
        { limit: "5" },
      );
      return list.json.commands.find((c: any) => c.commandId === commandId)?.status === "ACKNOWLEDGED";
    });
    await publishResult(commandId, "SUCCEEDED", { fan: true });

    await waitFor(async () => {
      const list = await api(server.httpUrl, device.token)(
        "GET",
        `/api/devices/${device.deviceId}/commands`,
        undefined,
        { limit: "5" },
      );
      const cmd = list.json.commands.find((c: any) => c.commandId === commandId);
      return cmd?.status === "SUCCEEDED" && cmd?.result?.reportedState?.fan === true;
    });

    // Reported device state is updated from the result.
    const state = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}/state`,
    );
    expect(state.json.state.reported.fan).toBe(true);
  });

  it("ignores duplicate result replays (first result wins)", async () => {
    const res = await api(server.httpUrl, device.token)(
      "POST",
      `/api/devices/${device.deviceId}/commands`,
      { capabilityId: "fan", params: { value: false } },
    );
    const commandId = res.json.command.commandId;
    await publishResult(commandId, "SUCCEEDED", { fan: false });
    await waitFor(async () => {
      const n = (
        server.db
          .prepare("SELECT COUNT(*) AS n FROM command_results WHERE command_id = ?")
          .get(commandId) as { n: number }
      ).n;
      return n === 1;
    });

    // Replay the identical result: it must not double-apply.
    await publishResult(commandId, "SUCCEEDED", { fan: false });
    await sleep(500);
    const rows = server.db
      .prepare("SELECT status FROM command_results WHERE command_id = ?")
      .all(commandId) as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("SUCCEEDED");
    const cmd = server.db
      .prepare("SELECT status FROM commands WHERE command_id = ?")
      .get(commandId) as { status: string };
    expect(cmd.status).toBe("SUCCEEDED");
  });

  it("marks unacknowledged commands EXPIRED via the sweeper", async () => {
    const res = await api(server.httpUrl, device.token)(
      "POST",
      `/api/devices/${device.deviceId}/commands`,
      { capabilityId: "fan", params: { value: true }, ttlMs: 200 },
    );
    expect(res.status).toBe(201);
    const commandId = res.json.command.commandId;

    // No result is ever published; let the TTL lapse, then sweep.
    await sleep(350);
    const expired = sweepExpiredCommands(server.db);
    expect(expired).toBeGreaterThanOrEqual(1);

    const cmd = server.db
      .prepare("SELECT status FROM commands WHERE command_id = ?")
      .get(commandId) as { status: string };
    expect(cmd.status).toBe("EXPIRED");

    const list = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}/commands`,
      undefined,
      { limit: "20" },
    );
    const found = list.json.commands.find((c: any) => c.commandId === commandId);
    expect(found.status).toBe("EXPIRED");
    expect(found.result.status).toBe("EXPIRED");
  });

  it("does not expire commands that already completed", async () => {
    const before = sweepExpiredCommands(server.db);
    // The SUCCEEDED commands from earlier tests must be untouched.
    const succeeded = server.db
      .prepare("SELECT COUNT(*) AS n FROM commands WHERE status = 'SUCCEEDED'")
      .get() as { n: number };
    expect(succeeded.n).toBeGreaterThanOrEqual(2);
    void before;
  });
});
