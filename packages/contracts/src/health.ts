import { z } from "zod";

/** Per-capability health as reported by the device firmware. */
export const CapabilityHealthSchema = z.enum(["good", "error", "unknown"]);
export type CapabilityHealth = z.infer<typeof CapabilityHealthSchema>;

/**
 * Periodic device health snapshot published on the health topic.
 * `uptime` is in seconds; `freeHeap` in bytes.
 */
export const HealthSchema = z.object({
  protocolVersion: z.literal("1.0"),
  deviceId: z.string().min(1),
  uptime: z.number().int().min(0),
  freeHeap: z.number().optional(),
  wifiRssi: z.number().optional(),
  mqtt: z.enum(["connected", "disconnected"]),
  firmware: z.string().min(1),
  sensorErrors: z.number().int().min(0),
  capabilityHealth: z.record(CapabilityHealthSchema),
  lastTelemetryAt: z.number().optional(),
  at: z.number(),
});
export type Health = z.infer<typeof HealthSchema>;

/**
 * Presence announcement on the presence topic (typically with the
 * MQTT will message configured for offline notification).
 */
export const PresenceSchema = z.object({
  protocolVersion: z.literal("1.0"),
  deviceId: z.string().min(1),
  online: z.boolean(),
  at: z.number(),
  firmware: z.string().optional(),
});
export type Presence = z.infer<typeof PresenceSchema>;

/** Device lifecycle state published on the status topic. */
export const DeviceStatusSchema = z.object({
  protocolVersion: z.literal("1.0"),
  deviceId: z.string().min(1),
  state: z.enum([
    "BOOT",
    "SELF_TEST",
    "NETWORK_CONNECTING",
    "MQTT_CONNECTING",
    "REGISTERING",
    "ONLINE",
    "OFFLINE",
    "RECONNECTING",
  ]),
  at: z.number(),
});
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;
