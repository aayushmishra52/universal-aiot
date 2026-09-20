/**
 * @aiot/contracts — canonical protocol layer for the Universal AIoT platform.
 *
 * MQTT topics, Zod schemas, and validation helpers shared by every package.
 * Import everything from this entrypoint; never duplicate a schema elsewhere.
 */

export * from "./topics.js";
export * from "./manifest.js";
export * from "./telemetry.js";
export * from "./command.js";
export * from "./health.js";
export * from "./auth.js";
export * from "./realtime.js";
export * from "./automation.js";
export * from "./validate.js";
export * from "./ids.js";
