/**
 * Canonical device manifest generation. The manifest is validated with
 * DeviceManifestSchema from @aiot/contracts — the same schema the platform
 * uses — and the identical JSON is embedded in the firmware (manifest_json.h)
 * so the retained manifest publish always matches manifest.json.
 */
import {
  DeviceManifestSchema,
  type Capability,
  type DeviceManifest,
} from "@aiot/contracts";
import { getBoard } from "../board-registry/index.js";
import { getSensor } from "../sensor-registry/index.js";
import { getActuator } from "../actuator-registry/index.js";
import type { GenerateInput } from "./input.js";

export function buildManifest(input: GenerateInput): DeviceManifest {
  const board = getBoard(input.boardId);
  if (!board) throw new Error(`Unknown board "${input.boardId}"`);

  const capabilities: Capability[] = [];
  for (const sel of input.sensors) {
    const sensor = getSensor(sel.sensorId);
    if (!sensor) throw new Error(`Unknown sensor "${sel.sensorId}"`);
    capabilities.push(...sensor.capabilitiesProduced);
  }
  for (const sel of input.actuators) {
    const actuator = getActuator(sel.actuatorId);
    if (!actuator) throw new Error(`Unknown actuator "${sel.actuatorId}"`);
    capabilities.push(actuator.capability);
  }

  return DeviceManifestSchema.parse({
    protocolVersion: "1.0",
    deviceId: input.deviceId,
    deviceType: board.name,
    manufacturer: "Universal AIoT",
    model: board.id,
    firmwareVersion: input.firmwareVersion,
    capabilities,
  });
}
