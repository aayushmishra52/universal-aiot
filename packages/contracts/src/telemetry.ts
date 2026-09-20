import { z } from "zod";

/** Whether the device clock was synchronized when the reading was taken. */
export const TimeQualitySchema = z.enum(["synchronized", "unsynchronized"]);
export type TimeQuality = z.infer<typeof TimeQualitySchema>;

/** Quality of a telemetry payload. */
export const TelemetryQualitySchema = z.enum(["good", "error"]);
export type TelemetryQuality = z.infer<typeof TelemetryQualitySchema>;

/**
 * A telemetry message published on the telemetry topic.
 * `timestamp` is ms epoch; 0 means the device clock was unsynchronized.
 * `sequence` is a per-boot monotonic counter used for dedup and ordering.
 */
export const TelemetrySchema = z.object({
  protocolVersion: z.literal("1.0"),
  deviceId: z.string().min(1),
  messageId: z.string().min(1),
  timestamp: z.number(),
  timeQuality: TimeQualitySchema,
  sequence: z.number().int().min(0),
  values: z.record(
    z.union([z.number(), z.string(), z.boolean()]),
    { description: "capabilityId -> reading" },
  ),
  quality: TelemetryQualitySchema.optional(),
});
export type Telemetry = z.infer<typeof TelemetrySchema>;
