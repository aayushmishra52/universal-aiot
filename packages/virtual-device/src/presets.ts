/**
 * Device presets + virtual sensor engines for @aiot/virtual-device.
 *
 * A preset describes a virtual device's identity and capabilities (the exact
 * shape that becomes the canonical device manifest). Sensor engines are pure
 * functions of elapsed virtual milliseconds, so sensor output is fully
 * deterministic under the VirtualClock.
 */
import type { Capability } from "@aiot/contracts";

/** A virtual sensor model: reading as a function of elapsed virtual ms. */
export type SensorEngine = (elapsedMs: number) => number;

/**
 * Building blocks for virtual sensor engines.
 *
 * - `constant(v)` — always returns v (e.g. a fixed test fixture).
 * - `sine(base, amplitude, periodMs, phase?)` — smooth periodic drift.
 * - `sequence(values)` — cycles through values, one per sample.
 * - `withNoise(engine, amplitude)` — adds uniform noise in [-amplitude, +amplitude].
 */
export const sensorEngines = {
  constant:
    (v: number): SensorEngine =>
    () =>
      v,

  sine:
    (
      base: number,
      amplitude: number,
      periodMs: number,
      phase = 0,
    ): SensorEngine =>
    (t: number) =>
      base + amplitude * Math.sin((2 * Math.PI * t) / periodMs + phase),

  sequence:
    (values: number[]): SensorEngine => {
      let i = 0;
      return () => values[i++ % values.length];
    },

  withNoise:
    (engine: SensorEngine, amplitude: number): SensorEngine =>
    (t: number) =>
      engine(t) + (Math.random() * 2 - 1) * amplitude,
};

/** A preset: device identity + capabilities + the engines behind its sensors. */
export interface DevicePreset {
  deviceType: string;
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  capabilities: Capability[];
  /** capabilityId -> engine; sensors without an engine read 0. */
  engines?: Record<string, SensorEngine>;
}

/** Golden-room temperature model: 25°C ± 3°C over a 120 s period. */
export function temperatureModel(tMs: number): number {
  return 25 + 3 * Math.sin((2 * Math.PI * tMs) / 120_000);
}

/** Golden-room humidity model: 55% ± 8% over a 180 s period. */
export function humidityModel(tMs: number): number {
  return 55 + 8 * Math.sin((2 * Math.PI * tMs) / 180_000 + 1);
}

/**
 * The golden-room preset: an environment device with temperature + humidity
 * sensors and a fan actuator. Used by `aiot-virtual-device --preset
 * golden-room` and by the e2e golden path.
 */
export function goldenRoomPreset(): DevicePreset {
  return {
    deviceType: "environment",
    manufacturer: "UniversalAIoT",
    model: "virtual-golden-room",
    firmwareVersion: "1.0.0",
    capabilities: [
      {
        id: "temperature",
        name: "Temperature",
        type: "number",
        kind: "sensor",
        unit: "celsius",
        min: -40,
        max: 125,
        precision: 1,
        samplingInterval: 2000,
        readOnly: true,
        category: "environment",
      },
      {
        id: "humidity",
        name: "Humidity",
        type: "number",
        kind: "sensor",
        unit: "percent",
        min: 0,
        max: 100,
        precision: 1,
        samplingInterval: 2000,
        readOnly: true,
        category: "environment",
      },
      {
        id: "fan",
        name: "Fan",
        type: "boolean",
        kind: "actuator",
        readOnly: false,
        category: "control",
      },
    ],
    engines: {
      temperature: temperatureModel,
      humidity: humidityModel,
    },
  };
}
