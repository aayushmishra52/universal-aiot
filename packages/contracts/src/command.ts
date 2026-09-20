import { z } from "zod";

/**
 * A command issued to a device on the command topic.
 * `action` is the capability action (e.g. "set"); `params` carries arguments.
 * A device must not execute a command after `expiresAt`.
 */
export const CommandSchema = z
  .object({
    kind: z.literal("command"),
    protocolVersion: z.literal("1.0"),
    commandId: z.string().min(1),
    deviceId: z.string().min(1),
    capabilityId: z.string().min(1),
    action: z.string().min(1),
    params: z.record(z.unknown()),
    issuedAt: z.number(),
    expiresAt: z.number(),
  })
  .refine((cmd) => cmd.issuedAt < cmd.expiresAt, {
    message: "command expiresAt must be after issuedAt",
  });
export type Command = z.infer<typeof CommandSchema>;

/** Lifecycle of a command from issuance to terminal state. */
export const CommandResultStatusSchema = z.enum([
  "QUEUED",
  "SENT",
  "ACKNOWLEDGED",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "REJECTED",
  "DUPLICATE",
]);
export type CommandResultStatus = z.infer<typeof CommandResultStatusSchema>;

/**
 * A command result published back on the command topic by the device
 * (or by the backend when it rejects/expires a command).
 */
export const CommandResultSchema = z.object({
  kind: z.literal("result"),
  protocolVersion: z.literal("1.0"),
  commandId: z.string().min(1),
  deviceId: z.string().min(1),
  status: CommandResultStatusSchema,
  reason: z.string().optional(),
  reportedState: z.record(z.unknown()).optional(),
  at: z.number(),
});
export type CommandResult = z.infer<typeof CommandResultSchema>;
