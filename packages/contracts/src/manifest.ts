import { z } from "zod";

/** Primitive data type of a capability's value. */
export const CapabilityTypeSchema = z.enum([
  "number",
  "integer",
  "boolean",
  "string",
  "enum",
]);
export type CapabilityType = z.infer<typeof CapabilityTypeSchema>;

/** Role of a capability on the device. */
export const CapabilityKindSchema = z.enum([
  "sensor",
  "actuator",
  "status",
  "computed",
]);
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>;

/**
 * A single device capability: one measurable or controllable channel.
 * The `id` is snake_case and stable across firmware versions.
 */
export const CapabilitySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        "capability id must be snake_case starting with a lowercase letter",
      ),
    name: z.string().min(1),
    type: CapabilityTypeSchema,
    kind: CapabilityKindSchema,
    unit: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    precision: z.number().int().min(0).optional(),
    samplingInterval: z
      .number()
      .int()
      .positive()
      .describe("Sampling interval in milliseconds")
      .optional(),
    readOnly: z.boolean().optional(),
    enumValues: z.array(z.string()).optional(),
    category: z.string().optional(),
    icon: z.string().optional(),
  })
  .refine(
    (cap) => cap.type !== "enum" || (cap.enumValues?.length ?? 0) > 0,
    { message: "enum capabilities require a non-empty enumValues array" },
  )
  .refine(
    (cap) =>
      cap.min === undefined || cap.max === undefined || cap.min < cap.max,
    { message: "capability min must be less than max" },
  );
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * The device manifest: self-description published on the manifest topic.
 * Everything in the platform is derived from this document.
 */
export const DeviceManifestSchema = z.object({
  protocolVersion: z.literal("1.0"),
  deviceId: z.string().min(1),
  deviceType: z.string().min(1),
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  firmwareVersion: z.string().min(1),
  capabilities: z.array(CapabilitySchema).min(1),
});
export type DeviceManifest = z.infer<typeof DeviceManifestSchema>;
