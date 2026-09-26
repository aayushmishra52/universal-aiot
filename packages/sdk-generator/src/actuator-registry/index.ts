/**
 * Actuator registry — every supported actuator, its capability, and the
 * command parameter contract the firmware enforces.
 */
import { CapabilitySchema, type Capability } from "@aiot/contracts";
import actuatorsJson from "./actuators.json" with { type: "json" };
import type { PinUsage } from "../board-registry/index.js";

export type ActuatorFnType = "bool" | "number";

export interface Actuator {
  id: string;
  name: string;
  capability: Capability;
  /** JSON-schema-style description of the accepted `params` object. */
  paramSchema: unknown;
  /** Value applied at boot before any command arrives. */
  safeDefault: boolean | number;
  wiring: { vcc: string; gnd: string; signal: string };
  pinUsage: PinUsage;
  fnType: ActuatorFnType;
}

interface RawActuator {
  id: string;
  name: string;
  capability: unknown;
  paramSchema: unknown;
  safeDefault: boolean | number;
  wiring: { vcc: string; gnd: string; signal: string };
  pinUsage: PinUsage;
  fnType: ActuatorFnType;
}

function load(): Record<string, Actuator> {
  const out: Record<string, Actuator> = {};
  for (const raw of (actuatorsJson as { actuators: RawActuator[] }).actuators) {
    out[raw.id] = { ...raw, capability: CapabilitySchema.parse(raw.capability) };
  }
  return out;
}

const REGISTRY = load();

export function listActuators(): Actuator[] {
  return Object.values(REGISTRY);
}

export function actuatorIds(): string[] {
  return Object.keys(REGISTRY);
}

export function getActuator(actuatorId: string): Actuator | undefined {
  return REGISTRY[actuatorId];
}
