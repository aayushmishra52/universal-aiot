import { describe, expect, it } from "vitest";
import { VirtualDevice } from "../src/device.js";
import { goldenRoomPreset } from "../src/presets.js";
import {
  PresenceSchema,
  HealthSchema,
  TelemetrySchema,
  DeviceManifestSchema,
} from "@aiot/contracts";
import {
  startBroker,
  subscribeObserver,
  waitFor,
  parseJson,
  endClient,
  type CollectedMessage,
} from "./helpers.js";

function presenceStates(messages: CollectedMessage[]) {
  return messages
    .map((m) => {
      try {
        return PresenceSchema.parse(parseJson(m.payload));
      } catch {
        return null;
      }
    })
    .filter((p) => p !== null);
}

describe("connection drop and reconnect", () => {
  it("broker sees presence offline (LWT); reconnect republishes presence online + manifest", async () => {
    const broker = await startBroker();
    const deviceId = "DEV-00020";
    const root = `aiot/v1/org1/proj1/${deviceId}`;
    try {
      const { client: observer, messages } = await subscribeObserver(broker.url, [
        `${root}/presence`,
        `${root}/manifest`,
      ]);
      const device = new VirtualDevice({
        brokerUrl: broker.url,
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
      await waitFor(
        () => presenceStates(messages).some((p) => p.online),
        5000,
      );
      const onlineCount = () =>
        presenceStates(messages).filter((p) => p.online).length;
      const manifestCount = () =>
        messages.filter((m) => m.topic === `${root}/manifest`).length;
      expect(manifestCount()).toBeGreaterThanOrEqual(1);

      // Force an unclean drop: broker must fire the LWT (presence offline).
      device.simulateDropConnection();
      await waitFor(
        () => presenceStates(messages).some((p) => !p.online),
        5000,
      );
      expect(device.getConnectionState()).toBe("reconnecting");

      // Exponential backoff reconnects (first retry after ~1s) and the device
      // re-announces: presence online + manifest republished.
      await waitFor(() => device.getConnectionState() === "connected", 10000);
      await waitFor(() => onlineCount() >= 2, 10000);
      await waitFor(() => manifestCount() >= 2, 10000);

      await device.disconnect();
      await endClient(observer);
    } finally {
      await broker.close();
    }
  });
});

describe("sensor failure injection", () => {
  it("telemetry quality 'error' and capabilityHealth.humidity 'error'", async () => {
    const broker = await startBroker();
    const deviceId = "DEV-00021";
    const root = `aiot/v1/org1/proj1/${deviceId}`;
    try {
      const { client: observer, messages } = await subscribeObserver(broker.url, [
        `${root}/telemetry`,
        `${root}/health`,
      ]);
      const device = new VirtualDevice({
        brokerUrl: broker.url,
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

      device.simulateSensorFailure("humidity");
      expect(device.getSensorErrors()).toBe(1);

      // 2 ticks = 2 virtual seconds -> humidity sample is due (and fails)
      device.tick();
      device.tick();
      await waitFor(
        () =>
          messages.some((m) => {
            if (m.topic !== `${root}/telemetry`) return false;
            try {
              return TelemetrySchema.parse(parseJson(m.payload)).quality === "error";
            } catch {
              return false;
            }
          }),
        5000,
      );
      const errorTelemetry = messages
        .filter((m) => m.topic === `${root}/telemetry`)
        .map((m) => TelemetrySchema.parse(parseJson(m.payload)))
        .find((t) => t.quality === "error");
      expect(errorTelemetry).toBeDefined();
      expect(errorTelemetry!.values.humidity).toBeUndefined();
      expect(errorTelemetry!.values.temperature).toBeTypeOf("number");

      // Drive the clock 30 virtual seconds to trigger the health heartbeat.
      for (let i = 0; i < 31; i++) device.tick();
      await waitFor(
        () =>
          messages.some((m) => {
            if (m.topic !== `${root}/health`) return false;
            try {
              const h = HealthSchema.parse(parseJson(m.payload));
              return h.capabilityHealth.humidity === "error";
            } catch {
              return false;
            }
          }),
        5000,
      );
      const health = messages
        .filter((m) => m.topic === `${root}/health`)
        .map((m) => HealthSchema.parse(parseJson(m.payload)))
        .find((h) => h.capabilityHealth.humidity === "error");
      expect(health).toBeDefined();
      expect(health!.capabilityHealth.temperature).toBe("good");
      expect(health!.capabilityHealth.fan).toBe("good");
      expect(health!.sensorErrors).toBe(1);

      // Clearing the failure restores good telemetry.
      device.clearSensorFailure("humidity");
      device.tick();
      device.tick();
      await waitFor(
        () =>
          messages.some((m) => {
            if (m.topic !== `${root}/telemetry`) return false;
            try {
              const t = TelemetrySchema.parse(parseJson(m.payload));
              return t.quality === "good" && typeof t.values.humidity === "number";
            } catch {
              return false;
            }
          }),
        5000,
      );

      await device.disconnect();
      await endClient(observer);
    } finally {
      await broker.close();
    }
  });

  it("manifest republished on reconnect is still valid", async () => {
    const broker = await startBroker();
    const deviceId = "DEV-00022";
    const root = `aiot/v1/org1/proj1/${deviceId}`;
    try {
      const { client: observer, messages } = await subscribeObserver(broker.url, [
        `${root}/manifest`,
      ]);
      const device = new VirtualDevice({
        brokerUrl: broker.url,
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
      device.simulateDropConnection();
      await waitFor(() => device.getConnectionState() === "connected", 10000);
      await waitFor(() => messages.length >= 2, 10000);
      for (const m of messages) {
        const manifest = DeviceManifestSchema.parse(parseJson(m.payload));
        expect(manifest.deviceId).toBe(deviceId);
      }
      await device.disconnect();
      await endClient(observer);
    } finally {
      await broker.close();
    }
  });
});
