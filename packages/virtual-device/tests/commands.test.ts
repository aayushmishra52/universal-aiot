import { describe, expect, it } from "vitest";
import { VirtualDevice } from "../src/device.js";
import { goldenRoomPreset } from "../src/presets.js";
import { CommandResultSchema, type CommandResult } from "@aiot/contracts";
import {
  startBroker,
  subscribeObserver,
  waitFor,
  parseJson,
  endClient,
  type CollectedMessage,
} from "./helpers.js";
import type { MqttClient } from "mqtt";

let commandCounter = 0;

function baseCommand(deviceId: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  commandCounter += 1;
  return {
    kind: "command",
    protocolVersion: "1.0",
    commandId: `cmd-${commandCounter}`,
    deviceId,
    capabilityId: "fan",
    action: "set",
    params: { value: true },
    issuedAt: now - 1000,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

interface Fixture {
  device: VirtualDevice;
  publisher: MqttClient;
  commandTopic: string;
  messages: CollectedMessage[];
  close(): Promise<void>;
}

async function setupCommandFixture(
  brokerUrl: string,
  deviceId: string,
): Promise<Fixture> {
  const commandTopic = `aiot/v1/org1/proj1/${deviceId}/command`;
  const { client: observer, messages } = await subscribeObserver(brokerUrl, [
    commandTopic,
  ]);
  const device = new VirtualDevice({
    brokerUrl,
    orgId: "org1",
    projectId: "proj1",
    deviceId,
    username: "u",
    password: "p",
    preset: goldenRoomPreset(),
    tickMs: 1000,
    manualTick: true,
  });
  await device.connect();
  return {
    device,
    publisher: observer,
    commandTopic,
    messages,
    close: async () => {
      await device.disconnect();
      await endClient(observer);
    },
  };
}

function resultsFor(messages: CollectedMessage[], commandId: string): CommandResult[] {
  return messages
    .map((m) => {
      try {
        return parseJson(m.payload) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && p.kind === "result" && p.commandId === commandId,
    )
    .map((p) => CommandResultSchema.parse(p));
}

async function waitForResults(
  fx: Fixture,
  commandId: string,
  count: number,
): Promise<CommandResult[]> {
  await waitFor(() => resultsFor(fx.messages, commandId).length >= count, 5000);
  return resultsFor(fx.messages, commandId);
}

describe("command round trip", () => {
  it("ACKNOWLEDGED then SUCCEEDED, fan turns on, reportedState correct", async () => {
    const { url, close: closeBroker } = await startBroker();
    const fx = await setupCommandFixture(url, "DEV-00010");
    try {
      const cmd = baseCommand("DEV-00010");
      fx.publisher.publish(fx.commandTopic, JSON.stringify(cmd), { qos: 1 });
      const results = await waitForResults(fx, cmd.commandId as string, 2);
      expect(results.map((r) => r.status)).toEqual(["ACKNOWLEDGED", "SUCCEEDED"]);
      expect(results[1].reportedState).toEqual({ fan: true });
      expect(fx.device.getState().reported.fan).toBe(true);
      expect(fx.device.getState().fanOn).toBe(true);
      expect(fx.device.getExecutionCount("fan")).toBe(1);
    } finally {
      await fx.close();
      await closeBroker();
    }
  });

  it("expired command -> EXPIRED result, fan unchanged", async () => {
    const { url, close: closeBroker } = await startBroker();
    const fx = await setupCommandFixture(url, "DEV-00011");
    try {
      const now = Date.now();
      const cmd = baseCommand("DEV-00011", {
        issuedAt: now - 60_000,
        expiresAt: now - 1000,
      });
      fx.publisher.publish(fx.commandTopic, JSON.stringify(cmd), { qos: 1 });
      const results = await waitForResults(fx, cmd.commandId as string, 1);
      expect(results[0].status).toBe("EXPIRED");
      expect(results[0].reason).toMatch(/expired/i);
      expect(fx.device.getState().fanOn).toBe(false);
      expect(fx.device.getExecutionCount("fan")).toBe(0);
    } finally {
      await fx.close();
      await closeBroker();
    }
  });

  it("duplicate commandId -> actuator applied once, second result DUPLICATE", async () => {
    const { url, close: closeBroker } = await startBroker();
    const fx = await setupCommandFixture(url, "DEV-00012");
    try {
      const cmd = baseCommand("DEV-00012");
      const id = cmd.commandId as string;
      fx.publisher.publish(fx.commandTopic, JSON.stringify(cmd), { qos: 1 });
      await waitForResults(fx, id, 2);
      // send the exact same command again
      fx.publisher.publish(fx.commandTopic, JSON.stringify(cmd), { qos: 1 });
      const results = await waitForResults(fx, id, 3);
      expect(results.map((r) => r.status)).toEqual([
        "ACKNOWLEDGED",
        "SUCCEEDED",
        "DUPLICATE",
      ]);
      expect(fx.device.getExecutionCount("fan")).toBe(1);
      expect(fx.device.getState().fanOn).toBe(true);
    } finally {
      await fx.close();
      await closeBroker();
    }
  });

  it("invalid param (fan=\"banana\") -> FAILED with INVALID_PARAMETER, fan unchanged", async () => {
    const { url, close: closeBroker } = await startBroker();
    const fx = await setupCommandFixture(url, "DEV-00013");
    try {
      const cmd = baseCommand("DEV-00013", { params: { value: "banana" } });
      fx.publisher.publish(fx.commandTopic, JSON.stringify(cmd), { qos: 1 });
      const results = await waitForResults(fx, cmd.commandId as string, 1);
      expect(results[0].status).toBe("FAILED");
      expect(results[0].reason).toMatch(/INVALID_PARAMETER/);
      expect(fx.device.getState().fanOn).toBe(false);
      expect(fx.device.getExecutionCount("fan")).toBe(0);
    } finally {
      await fx.close();
      await closeBroker();
    }
  });

  it("unknown capability -> REJECTED", async () => {
    const { url, close: closeBroker } = await startBroker();
    const fx = await setupCommandFixture(url, "DEV-00014");
    try {
      const cmd = baseCommand("DEV-00014", { capabilityId: "warp_drive" });
      fx.publisher.publish(fx.commandTopic, JSON.stringify(cmd), { qos: 1 });
      const results = await waitForResults(fx, cmd.commandId as string, 1);
      expect(results[0].status).toBe("REJECTED");
      expect(results[0].reason).toMatch(/unknown capability/);
      expect(fx.device.getExecutionCount("fan")).toBe(0);
    } finally {
      await fx.close();
      await closeBroker();
    }
  });

  it("ignores its own result messages on the command topic", async () => {
    const { url, close: closeBroker } = await startBroker();
    const fx = await setupCommandFixture(url, "DEV-00015");
    try {
      const cmd = baseCommand("DEV-00015");
      fx.publisher.publish(fx.commandTopic, JSON.stringify(cmd), { qos: 1 });
      await waitForResults(fx, cmd.commandId as string, 2);
      // wait a beat: no extra results should appear from result re-processing
      await new Promise((r) => setTimeout(r, 200));
      expect(resultsFor(fx.messages, cmd.commandId as string)).toHaveLength(2);
    } finally {
      await fx.close();
      await closeBroker();
    }
  });
});
