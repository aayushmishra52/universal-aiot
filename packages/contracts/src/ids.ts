import type { Command } from "./command.js";

/**
 * Build a deterministic, unique-per-boot message id.
 * Format: {deviceId}-{bootId}-{sequence padded to 6 digits}.
 */
export function makeMessageId(
  deviceId: string,
  bootId: string,
  sequence: number,
): string {
  return `${deviceId}-${bootId}-${String(sequence).padStart(6, "0")}`;
}

/** True when `nowMs` is strictly past the command's expiry. */
export function isExpired(command: Command, nowMs: number): boolean {
  return nowMs > command.expiresAt;
}
