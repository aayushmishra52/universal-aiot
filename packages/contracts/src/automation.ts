import { z } from "zod";

/** Trigger condition: compare a capability's value against a threshold. */
export const AutomationConditionSchema = z.object({
  capabilityId: z.string().min(1),
  operator: z.enum([">", ">=", "<", "<=", "==", "!="]),
  value: z.union([z.number(), z.string(), z.boolean()]),
});
export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;

/** Action to run when the condition holds. */
export const AutomationActionSchema = z.object({
  capabilityId: z.string().min(1),
  action: z.string().min(1).default("set"),
  params: z.record(z.unknown()),
});
export type AutomationAction = z.infer<typeof AutomationActionSchema>;

/**
 * A simple automation rule: when `condition` holds for a device in
 * `projectId`, execute `action`. `deviceId` narrows the rule to one device;
 * when omitted it applies to every device in the project.
 */
export const AutomationSchema = z.object({
  id: z.string().min(1).optional(),
  projectId: z.string().min(1),
  deviceId: z.string().min(1).optional(),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  condition: AutomationConditionSchema,
  action: AutomationActionSchema,
});
export type Automation = z.infer<typeof AutomationSchema>;
