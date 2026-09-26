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
  publicMqttUrl?: string;
  publicApiUrl?: string;
  mqttTlsPort?: number;
  mqttTlsKey?: string;
  mqttTlsCert?: string;
  tlsKey?: string;
  tlsCert?: string;
  /** Bind hosts (default 127.0.0.1). Set HTTP_HOST/MQTT_HOST=0.0.0.0 to
   * expose the API/broker on all interfaces for remote devices. */
  httpHost?: string;
  mqttHost?: string;
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
  /**
   * Publicly advertised connection URLs (shown in GET /api/devices/:id and
   * consumed by the dashboard and the aiot-sdk CLI). Defaults assume the
   * backend and broker run on the same host the user reaches over HTTP.
   * For remote devices set PUBLIC_MQTT_URL to a reachable broker — either
   * this backend's public address or a free external broker (HiveMQ Cloud /
   * EMQX Cloud free tier) instead of the embedded aedes broker.
   */
  publicMqttUrl: string;
  publicApiUrl: string;
  /** TLS listener for the embedded MQTT broker; enabled only when both key+cert are set. */
  mqttTlsPort: number;
  mqttTlsKey?: string;
  mqttTlsCert?: string;
  /** TLS key/cert for the HTTPS API listener (wired in server.ts). */
  tlsKey?: string;
  tlsCert?: string;
  /** Bind hosts (default 127.0.0.1). Set HTTP_HOST/MQTT_HOST=0.0.0.0 to
   * expose the API/broker on all interfaces for remote devices. */
  httpHost: string;
  mqttHost: string;
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
  const port = overrides.port ?? num(process.env.PORT, 4000);
  const mqttPort = overrides.mqttPort ?? num(process.env.MQTT_PORT, 1883);
  const mqttTlsPort = overrides.mqttTlsPort ?? num(process.env.MQTT_TLS_PORT, 8883);
  const mqttTlsKey = overrides.mqttTlsKey ?? process.env.MQTT_TLS_KEY;
  const mqttTlsCert = overrides.mqttTlsCert ?? process.env.MQTT_TLS_CERT;
  const mqttScheme = mqttTlsKey && mqttTlsCert ? "mqtts" : "mqtt";
  return {
    port,
    mqttPort,
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
    publicMqttUrl:
      overrides.publicMqttUrl ??
      process.env.PUBLIC_MQTT_URL ??
      `${mqttScheme}://localhost:${mqttTlsKey && mqttTlsCert ? mqttTlsPort : mqttPort}`,
    publicApiUrl:
      overrides.publicApiUrl ??
      process.env.PUBLIC_API_URL ??
      `http://localhost:${port}`,
    mqttTlsPort,
    mqttTlsKey,
    mqttTlsCert,
    tlsKey: overrides.tlsKey ?? process.env.TLS_KEY,
    tlsCert: overrides.tlsCert ?? process.env.TLS_CERT,
    httpHost: overrides.httpHost ?? process.env.HTTP_HOST ?? "127.0.0.1",
    mqttHost: overrides.mqttHost ?? process.env.MQTT_HOST ?? "127.0.0.1",
  };
}
