import { describe, expect, it } from "vitest";
import { VirtualClock } from "../src/clock.js";
import { VirtualDevice } from "../src/device.js";
import { goldenRoomPreset } from "../src/presets.js";
import { TelemetrySchema } from "@aiot/contracts";
import {
  startBroker,
  subscribeObserver,
  waitFor,
  parseJson,
  endClient,
} from "./helpers.js";

describe("VirtualClock", () => {
  it("starts at startMs, advances and sets", () => {
    const clock = new VirtualClock(1_000);
    expect(clock.now()).toBe(1_000);
    clock.advance(500);
    expect(clock.now()).toBe(1_500);
    clock.set(42);
    expect(clock.now()).toBe(42);
  });

  it("defaults to the current time", () => {
    const before = Date.now();
    const clock = new VirtualClock();
    expect(clock.now()).toBeGreaterThanOrEqual(before);
    expect(clock.now()).toBeLessThanOrEqual(Date.now());
  });
});

describe("manual tick drives telemetry without real timers", () => {
  it("samples on samplingInterval via tick() only; no auto loop", async () => {
    const broker = await startBroker();
    try {
      const topic = "aiot/v1/org1/proj1/DEV-00001/telemetry";
      const { client: observer, messages } = await subscribeObserver(broker.url, [
        topic,
      ]);
      const device = new VirtualDevice({
        brokerUrl: broker.url,
        orgId: "org1",
        projectId: "proj1",
        deviceId: "DEV-00001",
        username: "u",
        password: "p",
        preset: goldenRoomPreset(),
        tickMs: 1000,
        manualTick: true,
      });
      await device.connect();
      expect(device.getConnectionState()).toBe("connected");

      // samplingInterval is 2000ms, tickMs is 1000ms: first telemetry after
      // exactly 2 manual ticks, no real waiting involved.
      device.tick();
      expect(messages.length).toBe(0);
      device.tick();
      await waitFor(() => messages.length > 0);
      const first = TelemetrySchema.parse(parseJson(messages[0].payload));
      expect(first.sequence).toBe(0);
      expect(first.values.temperature).toBeTypeOf("number");
      expect(first.values.humidity).toBeTypeOf("number");

      // No automatic loop: real time passes, but no new telemetry arrives.
      const count = messages.length;
      await new Promise((r) => setTimeout(r, 150));
      expect(messages.length).toBe(count);

      // Manual ticks keep working and the sequence keeps increasing.
      device.tick();
      device.tick();
      await waitFor(() => messages.length >= count + 1);
      const second = TelemetrySchema.parse(
        parseJson(messages[count].payload),
      );
      expect(second.sequence).toBeGreaterThan(first.sequence);

      await device.disconnect();
      await endClient(observer);
    } finally {
      await broker.close();
    }
  });
});
