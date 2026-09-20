import { z } from "zod";

/** Device identity format: DEV- followed by 5-12 uppercase alphanumerics. */
export const DeviceIdSchema = z
  .string()
  .regex(
    /^DEV-[A-Z0-9]{5,12}$/,
    "deviceId must match DEV-XXXXX (5-12 uppercase alphanumerics)",
  );
export type DeviceId = z.infer<typeof DeviceIdSchema>;

/**
 * Identity a device presents when requesting pairing credentials.
 * `pairingUsername` is the per-device credential provisioned at manufacture.
 */
export const DeviceIdentitySchema = z.object({
  deviceId: DeviceIdSchema,
  pairingUsername: z.string().min(1),
});
export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>;

/** Pairing request: device asks the backend for operational MQTT credentials. */
export const PairingRequestSchema = z.object({
  deviceId: DeviceIdSchema,
  username: z.string().min(1),
  password: z.string().min(8),
});
export type PairingRequest = z.infer<typeof PairingRequestSchema>;

/** Result of a pairing request; `rotated` indicates new credentials were issued. */
export const PairingResultSchema = z.object({
  ok: z.boolean(),
  deviceId: DeviceIdSchema,
  projectId: z.string().min(1),
  orgId: z.string().min(1),
  rotated: z.boolean(),
});
export type PairingResult = z.infer<typeof PairingResultSchema>;

/** User role within an organization. */
export const UserRoleSchema = z.enum(["OWNER", "ADMIN", "VIEWER"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

/** Account registration request. */
export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/** Login request. */
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Claims carried by issued auth tokens. */
export const AuthTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  org: z.string().min(1),
  role: UserRoleSchema,
  iat: z.number(),
  exp: z.number(),
});
export type AuthTokenPayload = z.infer<typeof AuthTokenPayloadSchema>;
