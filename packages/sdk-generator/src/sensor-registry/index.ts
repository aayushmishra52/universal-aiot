/**
 * Sensor registry — every supported sensor and the capabilities it produces.
 */
import { CapabilitySchema, type Capability } from "@aiot/contracts";
import sensorsJson from "./sensors.json" with { type: "json" };
import type { PinUsage } from "../board-registry/index.js";

export type SensorAdapterKind = "analog" | "digital" | "dht22";

export interface RequiredLibrary {
  name: string;
  version: string;
}

export interface Sensor {
  id: string;
  name: string;
  interface: string;
  capabilitiesProduced: Capability[];
  requiredLibraries: RequiredLibrary[];
  wiring: { vcc: string; gnd: string; signal: string };
  pinUsage: PinUsage;
  adapter: SensorAdapterKind;
}

interface RawSensor {
  id: string;
  name: string;
  interface: string;
  capabilitiesProduced: unknown[];
  requiredLibraries: RequiredLibrary[];
  wiring: { vcc: string; gnd: string; signal: string };
  pinUsage: PinUsage;
  adapter: SensorAdapterKind;
}

function load(): Record<string, Sensor> {
  const out: Record<string, Sensor> = {};
  for (const raw of (sensorsJson as { sensors: RawSensor[] }).sensors) {
    out[raw.id] = {
      ...raw,
      capabilitiesProduced: raw.capabilitiesProduced.map((c) =>
        CapabilitySchema.parse(c),
      ),
    };
  }
  return out;
}

const REGISTRY = load();

export function listSensors(): Sensor[] {
  return Object.values(REGISTRY);
}

export function sensorIds(): string[] {
  return Object.keys(REGISTRY);
}

export function getSensor(sensorId: string): Sensor | undefined {
  return REGISTRY[sensorId];
}
