import type { Capability } from "./manifest.js";

export interface CapabilityValidationResult {
  ok: boolean;
  reason?: string;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Validate a candidate value against a capability definition.
 * Checks primitive type match, integer-ness for `integer` capabilities,
 * min/max bounds for numeric capabilities, and enum membership.
 */
export function validateCapabilityValue(
  capability: Capability,
  value: unknown,
): CapabilityValidationResult {
  switch (capability.type) {
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return {
          ok: false,
          reason: `capability ${capability.id} expects a number, got ${typeName(value)}`,
        };
      }
      break;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return {
          ok: false,
          reason: `capability ${capability.id} expects an integer, got ${typeName(value)}`,
        };
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return {
          ok: false,
          reason: `capability ${capability.id} expects a boolean, got ${typeName(value)}`,
        };
      }
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        return {
          ok: false,
          reason: `capability ${capability.id} expects a string, got ${typeName(value)}`,
        };
      }
      break;
    }
    case "enum": {
      if (typeof value !== "string") {
        return {
          ok: false,
          reason: `capability ${capability.id} expects one of [${(capability.enumValues ?? []).join(", ")}], got ${typeName(value)}`,
        };
      }
      if (!(capability.enumValues ?? []).includes(value)) {
        return {
          ok: false,
          reason: `capability ${capability.id}: "${value}" is not one of [${(capability.enumValues ?? []).join(", ")}]`,
        };
      }
      break;
    }
  }

  if (
    (capability.type === "number" || capability.type === "integer") &&
    typeof value === "number"
  ) {
    if (capability.min !== undefined && value < capability.min) {
      return {
        ok: false,
        reason: `capability ${capability.id}: ${value} is below minimum ${capability.min}`,
      };
    }
    if (capability.max !== undefined && value > capability.max) {
      return {
        ok: false,
        reason: `capability ${capability.id}: ${value} is above maximum ${capability.max}`,
      };
    }
  }

  return { ok: true };
}
