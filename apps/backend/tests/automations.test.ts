import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  connectDevice,
  deviceUsername,
  provisionDevice,
  publishManifest,
  publishTelemetry,
  sleep,
  startTestServer,
  waitFor,
  type ServerHandles,
  type TestDevice,
} from "./helpers.js";
import { commandTopic } from "./helpers.js";

let server: ServerHandles;
let device: TestDevice;
let fake: import("mqtt").MqttClient;
const receivedCommands: any[] = [];

beforeAll(async () => {
  server = await startTestServer();
  const provisioned = await provisionDevice(server, "autouser", "auto-1");
  device = provisioned.device;
  fake = await connectDevice(server, deviceUsername(device.deviceId), device.deviceToken);
  await fake.subscribeAsync(commandTopic(device.orgId, device.projectId, device.deviceId));
  fake.on("message", (_topic, payload) => {
    try {
      receivedCommands.push(JSON.parse(payload.toString()));
    } catch {
      // ignore
    }
  });
  await publishManifest(fake, device.orgId, device.projectId, device.deviceId);
  await waitFor(async () => {
    const detail = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}`,
    );
    return detail.json.capabilities.length === 2;
  });
});

afterAll(async () => {
  await fake?.endAsync();
  await server.stop();
});

describe("automations", () => {
  it("creates, lists, and validates automations (ADMIN+ for write)", async () => {
    const created = await api(server.httpUrl, device.token)(
      "POST",
      `/api/projects/${device.projectId}/automations`,
      {
        name: "cool when hot",
        condition: { capabilityId: "temp", operator: ">", value: 30 },
        action: { capabilityId: "fan", action: "set", params: { value: true } },
      },
    );
    expect(created.status).toBe(201);
    expect(created.json.automation.name).toBe("cool when hot");
    expect(created.json.automation.enabled).toBe(true);
    const automationId = created.json.automation.id;

    const invalid = await api(server.httpUrl, device.token)(
      "POST",
      `/api/projects/${device.projectId}/automations`,
      {
        name: "bad",
        condition: { capabilityId: "temp", operator: ">>", value: 30 },
        action: { capabilityId: "fan", action: "set", params: { value: true } },
      },
    );
    expect(invalid.status).toBe(400);

    const listed = await api(server.httpUrl, device.token)(
      "GET",
      `/api/projects/${device.projectId}/automations`,
    );
    expect(listed.status).toBe(200);
    expect(listed.json.automations).toHaveLength(1);

    const fetched = await api(server.httpUrl, device.token)(
      "GET",
      `/api/projects/${device.projectId}/automations/${automationId}`,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.json.automation.condition.operator).toBe(">");
  });

  it("fires when telemetry crosses the threshold, publishing a command", async () => {
    receivedCommands.length = 0;

    // Below threshold: nothing happens.
    await publishTelemetry(fake, device.orgId, device.projectId, device.deviceId, {
      temp: 25,
    });
    await sleep(600);
    expect(receivedCommands.filter((c) => c.kind === "command")).toHaveLength(0);

    // Above threshold: the engine issues a command and the fake device gets it.
    await publishTelemetry(fake, device.orgId, device.projectId, device.deviceId, {
      temp: 35,
    });
    await waitFor(() =>
      receivedCommands.some(
        (c) => c.kind === "command" && c.capabilityId === "fan",
      ),
    );
    const wire = receivedCommands.find(
      (c) => c.kind === "command" && c.capabilityId === "fan",
    );
    expect(wire.params).toEqual({ value: true });

    // The command is attributed to the automation.
    await waitFor(async () => {
      const list = await api(server.httpUrl, device.token)(
        "GET",
        `/api/devices/${device.deviceId}/commands`,
        undefined,
        { limit: "10" },
      );
      return list.json.commands.some((c: any) =>
        String(c.createdBy).startsWith("automation:"),
      );
    });

    const runs = await api(server.httpUrl, device.token)(
      "GET",
      `/api/projects/${device.projectId}/automations`,
    );
    const automationId = runs.json.automations[0].id;
    const runList = await api(server.httpUrl, device.token)(
      "GET",
      `/api/projects/${device.projectId}/automations/${automationId}/runs`,
    );
    expect(runList.status).toBe(200);
    expect(runList.json.runs).toHaveLength(1);
    expect(runList.json.runs[0].detail.commandId).toBe(wire.commandId);
  });

  it("respects the 60s cooldown (no duplicate commands)", async () => {
    const before = (
      await api(server.httpUrl, device.token)(
        "GET",
        `/api/devices/${device.deviceId}/commands`,
        undefined,
        { limit: "50" },
      )
    ).json.commands.length;
    const commandsBefore = receivedCommands.filter((c) => c.kind === "command").length;

    await publishTelemetry(fake, device.orgId, device.projectId, device.deviceId, {
      temp: 36,
    });
    await sleep(800);

    const after = (
      await api(server.httpUrl, device.token)(
        "GET",
        `/api/devices/${device.deviceId}/commands`,
        undefined,
        { limit: "50" },
      )
    ).json.commands.length;
    expect(after).toBe(before);
    expect(receivedCommands.filter((c) => c.kind === "command").length).toBe(commandsBefore);
  });

  it("supports update and delete", async () => {
    const listed = await api(server.httpUrl, device.token)(
      "GET",
      `/api/projects/${device.projectId}/automations`,
    );
    const automationId = listed.json.automations[0].id;

    const updated = await api(server.httpUrl, device.token)(
      "PUT",
      `/api/projects/${device.projectId}/automations/${automationId}`,
      {
        name: "cool when hot",
        enabled: false,
        condition: { capabilityId: "temp", operator: ">", value: 30 },
        action: { capabilityId: "fan", action: "set", params: { value: true } },
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.json.automation.enabled).toBe(false);

    // Disabled: no command fires.
    const commandsBefore = receivedCommands.filter((c) => c.kind === "command").length;
    await publishTelemetry(fake, device.orgId, device.projectId, device.deviceId, {
      temp: 40,
    });
    await sleep(600);
    expect(receivedCommands.filter((c) => c.kind === "command").length).toBe(commandsBefore);

    const deleted = await api(server.httpUrl, device.token)(
      "DELETE",
      `/api/projects/${device.projectId}/automations/${automationId}`,
    );
    expect(deleted.status).toBe(200);
    const gone = await api(server.httpUrl, device.token)(
      "GET",
      `/api/projects/${device.projectId}/automations/${automationId}`,
    );
    expect(gone.status).toBe(404);
  });
});
