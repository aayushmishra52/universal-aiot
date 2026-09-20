import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mqtt from "mqtt";
import {
  PROTOCOL_VERSION,
  makeMessageId,
  topicCommand,
  topicManifest,
  topicTelemetry,
} from "@aiot/contracts";
import { startServer, type ServerHandles } from "../src/server.js";

export type { ServerHandles };

/** Boot an isolated backend: ephemeral ports, temp SQLite file. */
export async function startTestServer(
  overrides: Record<string, number | string> = {},
): Promise<ServerHandles> {
  const dir = mkdtempSync(join(tmpdir(), "aiot-test-"));
  return startServer({
    port: 0,
    mqttPort: 0,
    wsPort: 0,
    databaseUrl: `file:${join(dir, "aiot.db")}`,
    jwtSecret: "test-secret-not-a-real-secret",
    rateLimitAuthPerMin: 1000,
    rateLimitGlobalPerMin: 10000,
    // Tests drive the sweeper explicitly; keep the interval out of the way.
    sweepIntervalMs: 3_600_000,
    ...overrides,
  });
}

export interface ApiResponse {
  status: number;
  json: any;
}

/** Minimal JSON API client. */
export function api(baseUrl: string, token?: string) {
  return async (
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<ApiResponse> => {
    const url = new URL(path, baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      method,
      headers: {
        ...(body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // non-JSON body
    }
    return { status: res.status, json };
  };
}

export async function registerUser(
  server: ServerHandles,
  name: string,
  email: string,
  password: string,
): Promise<{ token: string; user: any; org: any }> {
  const res = await api(server.httpUrl)("POST", "/api/auth/register", {
    name,
    email,
    password,
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

export async function createProject(
  server: ServerHandles,
  token: string,
  orgId: string,
  name: string,
): Promise<any> {
  const res = await api(server.httpUrl, token)("POST", `/api/orgs/${orgId}/projects`, {
    name,
  });
  if (res.status !== 201) {
    throw new Error(`createProject failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json.project;
}

export async function createDevice(
  server: ServerHandles,
  token: string,
  projectId: string,
  name: string,
): Promise<{ device: any; pairing: { deviceId: string; username: string; password: string } }> {
  const res = await api(server.httpUrl, token)(
    "POST",
    `/api/projects/${projectId}/devices`,
    { name },
  );
  if (res.status !== 201) {
    throw new Error(`createDevice failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

export async function pairDevice(
  server: ServerHandles,
  token: string,
  deviceId: string,
  username: string,
  password: string,
): Promise<any> {
  const res = await api(server.httpUrl, token)("POST", "/api/pair", {
    deviceId,
    username,
    password,
  });
  if (res.status !== 200) {
    throw new Error(`pair failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

export interface TestDevice {
  orgId: string;
  projectId: string;
  deviceId: string;
  deviceToken: string;
  token: string;
}

/** Full happy-path provisioning: user -> org -> project -> device -> paired. */
export async function provisionDevice(
  server: ServerHandles,
  userSeed: string,
  deviceName = "sensor-1",
): Promise<{ user: any; org: any; project: any; device: TestDevice }> {
  const reg = await registerUser(
    server,
    `User ${userSeed}`,
    `${userSeed}@example.com`,
    "password123",
  );
  const project = await createProject(server, reg.token, reg.org.id, "home");
  const created = await createDevice(server, reg.token, project.id, deviceName);
  const paired = await pairDevice(
    server,
    reg.token,
    created.pairing.deviceId,
    created.pairing.username,
    created.pairing.password,
  );
  return {
    user: reg.user,
    org: reg.org,
    project,
    device: {
      orgId: reg.org.id,
      projectId: project.id,
      deviceId: created.pairing.deviceId,
      deviceToken: paired.deviceToken,
      token: reg.token,
    },
  };
}

/** Connect an mqtt.js client as a device. */
export async function connectDevice(
  server: ServerHandles,
  username: string,
  password: string,
): Promise<mqtt.MqttClient> {
  const client = mqtt.connect(`mqtt://127.0.0.1:${server.mqttPort}`, {
    username,
    password,
    clientId: `test-${Math.random().toString(36).slice(2)}`,
    reconnectPeriod: 0,
    connectTimeout: 5000,
  });
  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("error", (err) => reject(err));
  });
  return client;
}

const pairingUsernameFor = (deviceId: string) => `device_${deviceId.replace(/-/g, "")}`;

export function deviceUsername(deviceId: string): string {
  return pairingUsernameFor(deviceId);
}

export function manifestPayload(deviceId: string): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    deviceId,
    deviceType: "thermostat",
    manufacturer: "TestCo",
    model: "T-1000",
    firmwareVersion: "1.2.3",
    capabilities: [
      { id: "temp", name: "Temperature", type: "number", kind: "sensor", unit: "C" },
      { id: "fan", name: "Fan", type: "boolean", kind: "actuator" },
    ],
  };
}

let seqCounter = 0;

export function telemetryPayload(
  deviceId: string,
  values: Record<string, number | string | boolean>,
  messageId?: string,
): Record<string, unknown> {
  seqCounter += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    deviceId,
    messageId: messageId ?? makeMessageId(deviceId, "testboot", seqCounter),
    timestamp: Date.now(),
    timeQuality: "synchronized",
    sequence: seqCounter,
    values,
  };
}

export async function publishManifest(
  client: mqtt.MqttClient,
  orgId: string,
  projectId: string,
  deviceId: string,
): Promise<void> {
  await client.publishAsync(topicManifest(orgId, projectId, deviceId), JSON.stringify(manifestPayload(deviceId)), {
    qos: 1,
    retain: true,
  });
}

export async function publishTelemetry(
  client: mqtt.MqttClient,
  orgId: string,
  projectId: string,
  deviceId: string,
  values: Record<string, number | string | boolean>,
  messageId?: string,
): Promise<void> {
  await client.publishAsync(
    topicTelemetry(orgId, projectId, deviceId),
    JSON.stringify(telemetryPayload(deviceId, values, messageId)),
    { qos: 1 },
  );
}

export function commandTopic(orgId: string, projectId: string, deviceId: string): string {
  return topicCommand(orgId, projectId, deviceId);
}

/** Poll until `fn` returns true or the timeout elapses. */
export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
  intervalMs = 60,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
