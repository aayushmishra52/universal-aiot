import { randomInt } from "node:crypto";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Cryptographically random uppercase alphanumeric string (for ids, tokens). */
export function randomAlnum(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALNUM[randomInt(ALNUM.length)];
  return out;
}

/** The MQTT username a device uses, derived from its device id. */
export function pairingUsernameFor(deviceId: string): string {
  return `device_${deviceId.replace(/-/g, "")}`;
}

export function nowMs(): number {
  return Date.now();
}

/** Parse a JSON string, returning `fallback` when parsing fails. */
export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
