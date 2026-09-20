import { z } from "zod";

/** Realtime events emitted by the backend to subscribed clients. */
export const RealtimeEventKindSchema = z.enum([
  "device.online",
  "device.offline",
  "device.telemetry",
  "device.state_changed",
  "device.health",
  "command.created",
  "command.acknowledged",
  "command.failed",
  "automation.triggered",
]);
export type RealtimeEventKind = z.infer<typeof RealtimeEventKindSchema>;

/**
 * A realtime event broadcast to clients. `deviceId` is absent for
 * project-scoped events that do not reference a single device.
 */
export const RealtimeEventSchema = z.object({
  kind: RealtimeEventKindSchema,
  projectId: z.string().min(1),
  deviceId: z.string().min(1).optional(),
  at: z.number(),
  data: z.record(z.unknown()),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
