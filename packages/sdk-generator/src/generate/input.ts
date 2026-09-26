/**
 * `aiot-sdk create` input: validation only. Rendering lives in render.ts.
 */
import { getBoard, boardIds, validatePin } from "../board-registry/index.js";
import { getSensor } from "../sensor-registry/index.js";
import { getActuator } from "../actuator-registry/index.js";

export interface SensorSelection {
  sensorId: string;
  pin: number;
}

export interface ActuatorSelection {
  actuatorId: string;
  pin: number;
}

export interface GenerateInput {
  boardId: string;
  deviceId: string;
  projectId: string;
  orgId: string;
  deviceName: string;
  firmwareVersion: string;
  sensors: SensorSelection[];
  actuators: ActuatorSelection[];
  mqttHost: string;
  mqttPort: number;
  mqttUser: string;
  mqttPass: string;
  wifiSsid: string;
  wifiPass: string;
  tls: boolean;
  outDir: string;
  /**
   * Sketchbook libraries dir used for the sketch.yaml `- dir:` library
   * references. Optional: when omitted, rendering falls back to the
   * conventional location (~/Arduino/libraries). `aiot-sdk create`
   * resolves the real location (honouring `arduino-cli config`) and
   * passes it explicitly.
   */
  libraryDir?: string;
}

export const DEVICE_ID_REGEX = /^DEV-[A-Z0-9]{5,12}$/;

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Generate a random valid device id, e.g. DEV-9K2QX7. */
export function generateDeviceId(): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)];
  }
  return `DEV-${suffix}`;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validate everything BEFORE generating. Returns human-friendly errors;
 * the caller prints them and aborts without writing anything.
 */
export function validateGenerateInput(input: GenerateInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const board = getBoard(input.boardId);
  if (!board) {
    errors.push(
      `Unknown board "${input.boardId}". Known boards: ${boardIds().join(", ")}.`,
    );
  }

  if (!DEVICE_ID_REGEX.test(input.deviceId)) {
    errors.push(
      `Invalid device id "${input.deviceId}". It must match ${DEVICE_ID_REGEX} (e.g. DEV-9K2QX7).`,
    );
  }
  for (const [label, value] of [
    ["device name", input.deviceName],
    ["project id", input.projectId],
    ["org id", input.orgId],
  ] as const) {
    if (!value || !value.trim()) errors.push(`Missing ${label}.`);
  }

  if (!input.mqttHost || !input.mqttHost.trim()) {
    errors.push("Missing MQTT host.");
  }
  if (!Number.isInteger(input.mqttPort) || input.mqttPort < 1 || input.mqttPort > 65535) {
    errors.push(`Invalid MQTT port "${input.mqttPort}". Use 1-65535.`);
  }

  if (input.sensors.length === 0 && input.actuators.length === 0) {
    errors.push("Select at least one sensor or actuator.");
  }

  // Capability ids must be unique across the whole device (dht22 already
  // produces temperature+humidity, so a second "temperature" sensor clashes).
  const seenCapabilities = new Map<string, string>();

  const usedPins = new Map<number, string>();
  const checkPin = (
    kind: "sensor" | "actuator",
    id: string,
    pin: number,
    usage: "digital" | "adc" | "pwm",
  ) => {
    if (!Number.isInteger(pin) || pin < 0) {
      errors.push(`Invalid pin "${pin}" for ${kind} "${id}".`);
      return;
    }
    const owner = usedPins.get(pin);
    if (owner !== undefined) {
      errors.push(
        `GPIO ${pin} is assigned twice (${owner} and ${kind} "${id}"). Every pin must be unique.`,
      );
      return;
    }
    usedPins.set(pin, `${kind} "${id}"`);
    if (!board) return;
    const result = validatePin(board.id, pin, usage);
    if (!result.ok) {
      errors.push(result.reason ?? `GPIO ${pin} is not usable as ${usage}.`);
    } else if (result.warning) {
      warnings.push(`GPIO ${pin} (${kind} "${id}"): ${result.warning}`);
    }
  };

  for (const sel of input.sensors) {
    const sensor = getSensor(sel.sensorId);
    if (!sensor) {
      errors.push(`Unknown sensor "${sel.sensorId}".`);
      continue;
    }
    for (const cap of sensor.capabilitiesProduced) {
      const prev = seenCapabilities.get(cap.id);
      if (prev) {
        errors.push(
          `Capability "${cap.id}" is produced twice (by ${prev} and sensor "${sel.sensorId}"). Pick one.`,
        );
      } else {
        seenCapabilities.set(cap.id, `sensor "${sel.sensorId}"`);
      }
    }
    checkPin("sensor", sel.sensorId, sel.pin, sensor.pinUsage);
  }

  for (const sel of input.actuators) {
    const actuator = getActuator(sel.actuatorId);
    if (!actuator) {
      errors.push(`Unknown actuator "${sel.actuatorId}".`);
      continue;
    }
    const capId = actuator.capability.id;
    const prev = seenCapabilities.get(capId);
    if (prev) {
      errors.push(
        `Capability "${capId}" is produced twice (by ${prev} and actuator "${sel.actuatorId}"). Pick one.`,
      );
    } else {
      seenCapabilities.set(capId, `actuator "${sel.actuatorId}"`);
    }
    checkPin("actuator", sel.actuatorId, sel.pin, actuator.pinUsage);
  }

  return { errors, warnings };
}
