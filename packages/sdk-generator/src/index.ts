/**
 * @aiot/sdk-generator — public programmatic API.
 *
 * The CLI (`aiot-sdk`) is the primary surface; this entry point exposes the
 * building blocks for embedding generation/validation in other tools.
 */
export {
  renderProject,
  writeProject,
  deviceSlugFor,
  packageRoot,
  templateRoot,
  GENERATOR_VERSION,
  type RenderedFile,
} from "./generate/render.js";
export {
  validateGenerateInput,
  generateDeviceId,
  DEVICE_ID_REGEX,
  type GenerateInput,
  type SensorSelection,
  type ActuatorSelection,
  type ValidationResult,
} from "./generate/input.js";
export { buildManifest } from "./generate/manifest.js";
export { planFirmware, type FirmwarePlan } from "./generate/firmware.js";
export {
  listBoards,
  boardIds,
  getBoard,
  validatePin,
  type Board,
  type BoardPins,
  type PinValidation,
  type PinUsage,
} from "./board-registry/index.js";
export {
  listSensors,
  sensorIds,
  getSensor,
} from "./sensor-registry/index.js";
export {
  listActuators,
  actuatorIds,
  getActuator,
} from "./actuator-registry/index.js";
export { PINNED_VERSIONS, type PinnedVersions } from "./versions.js";
export { defaultSketchbookDir, defaultLibraryDir } from "./arduino-dirs.js";
