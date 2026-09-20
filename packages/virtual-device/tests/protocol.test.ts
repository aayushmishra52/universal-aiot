import { describe, expect, it } from "vitest";
import { VirtualDevice } from "../src/device.js";
import { goldenRoomPreset, temperatureModel, humidityModel } from "../src/presets.js";
import {
  DeviceManifestSchema,
  TelemetrySchema,
  makeMessageId,
} from "@aiot/contracts";
import {
  startBroker,
  subscribeObserver,
  waitFor,
  parseJson,
  endClient,
} from "./helpers.js";

function makeDevice(brokerUrl: string, deviceId: string): VirtualDevice {
  return new VirtualDevice({
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
}

describe("manifest", () => {
  it("publishes a manifest valid per DeviceManifestSchema on connect", async () => {
    const broker = await startBroker();
    try {
      const topic = "aiot/v1/org1/proj1/DEV-00002/manifest";
      const { client: observer, messages } = await subscribeObserver(broker.url, [
        topic,
      ]);
      const device = makeDevice(broker.url, "DEV-00002");
      await device.connect();
      await waitFor(() => messages.length > 0);
      const manifest = DeviceManifestSchema.parse(parseJson(messages[0].payload));
      expect(manifest.deviceId).toBe("DEV-00002");
      expect(manifest.protocolVersion).toBe("1.0");
      expect(manifest.capabilities.map((c) => c.id)).toEqual([
        "temperature",
        "humidity",
        "fan",
      ]);
      await device.disconnect();
      await endClient(observer);
    } finally {
      await broker.close();
    }
  });
});

describe("telemetry", () => {
  it("is valid per TelemetrySchema with increasing sequence and proper messageId", async () => {
    const broker = await startBroker();
    try {
      const topic = "aiot/v1/org1/proj1/DEV-00003/telemetry";
      const { client: observer, messages } = await subscribeObserver(broker.url, [
        topic,
      ]);
      const device = makeDevice(broker.url, "DEV-00003");
      await device.connect();

      for (let i = 0; i < 3; i++) {
        device.tick();
        device.tick(); // 2 virtual seconds -> one telemetry each
      }
      await waitFor(() => messages.length >= 3);

      const parsed = messages
        .slice(0, 3)
        .map((m) => TelemetrySchema.parse(parseJson(m.payload)));
      expect(parsed.map((t) => t.sequence)).toEqual([0, 1, 2]);
      for (const t of parsed) {
        expect(t.messageId).toMatch(/^DEV-00003-[0-9a-f]{8}-\d{6}$/);
        expect(t.protocolVersion).toBe("1.0");
        expect(t.timeQuality).toBe("synchronized");
        expect(t.quality).toBe("good");
      }
      // messageId embeds the sequence via makeMessageId
      expect(parsed[1].messageId.endsWith("-000001")).toBe(true);

      await device.disconnect();
      await endClient(observer);
    } finally {
      await broker.close();
    }
  });

  it("follows the golden-room sensor models", () => {
    // t = 0 -> temperature 25.0, humidity 55 + 8*sin(1)
    expect(temperatureModel(0)).toBeCloseTo(25, 9);
    expect(humidityModel(0)).toBeCloseTo(55 + 8 * Math.sin(1), 9);
    // quarter period -> peak
    expect(temperatureModel(30_000)).toBeCloseTo(28, 9);
    // makeMessageId format used by telemetry
    expect(makeMessageId("DEV-1", "abcdef12", 7)).toBe("DEV-1-abcdef12-000007");
  });
});
