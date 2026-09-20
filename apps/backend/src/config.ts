import dotenv from "dotenv";

dotenv.config();

export interface ConfigOverrides {
  port?: number;
  mqttPort?: number;
  wsPort?: number;
  databaseUrl?: string;
  jwtSecret?: string;
  jwtExpiresIn?: string;
  rateLimitAuthPerMin?: number;
  rateLimitGlobalPerMin?: number;
  sweepIntervalMs?: number;
  pairingTtlHours?: number;
}

export interface AppConfig {
  port: number;
  mqttPort: number;
  wsPort: number;
  /** Filesystem path of the SQLite database (DATABASE_URL minus the file: prefix). */
  databasePath: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  /** Max auth/pair requests per IP per minute (aggressive limiter). */
  rateLimitAuthPerMin: number;
  /** Max requests per IP per minute for all other routes. */
  rateLimitGlobalPerMin: number;
  /** How often the command-expiry sweeper runs. */
  sweepIntervalMs: number;
  /** How long a device pairing credential stays valid. */
  pairingTtlMs: number;
}

function num(value: string | undefined, def: number): number {
  if (value === undefined || value === "") return def;
  const n = Number(value);
  return Number.isFinite(n) ? n : def;
}

/**
 * Load and validate runtime configuration.
 * JWT_SECRET is required and the process must not boot without it.
 */
export function loadConfig(overrides: ConfigOverrides = {}): AppConfig {
  const jwtSecret = overrides.jwtSecret ?? process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      "JWT_SECRET is required: set it in the environment or a .env file (see .env.example).",
    );
  }
  const databaseUrl =
    overrides.databaseUrl ?? process.env.DATABASE_URL ?? "file:./data/aiot.db";
  const databasePath = databaseUrl.startsWith("file:")
    ? databaseUrl.slice("file:".length)
    : databaseUrl;
  return {
    port: overrides.port ?? num(process.env.PORT, 4000),
    mqttPort: overrides.mqttPort ?? num(process.env.MQTT_PORT, 1883),
    wsPort: overrides.wsPort ?? num(process.env.WS_PORT, 4001),
    databasePath,
    jwtSecret,
    jwtExpiresIn:
      overrides.jwtExpiresIn ?? process.env.JWT_EXPIRES_IN ?? "12h",
    rateLimitAuthPerMin:
      overrides.rateLimitAuthPerMin ??
      num(process.env.RATE_LIMIT_AUTH_PER_MIN, 30),
    rateLimitGlobalPerMin:
      overrides.rateLimitGlobalPerMin ??
      num(process.env.RATE_LIMIT_GLOBAL_PER_MIN, 600),
    sweepIntervalMs: num(process.env.SWEEP_INTERVAL_MS, 10_000),
    pairingTtlMs:
      num(process.env.PAIRING_TTL_HOURS, 24) * 3_600_000,
  };
}
