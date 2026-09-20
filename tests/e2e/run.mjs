#!/usr/bin/env node
/**
 * Universal AIoT — end-to-end acceptance runner (steps 1–16 + security checks).
 *
 * Spins up a fresh backend (HTTP + MQTT + WS) on test ports, runs a virtual
 * device through pairing, telemetry, commands, safety checks, disconnect /
 * reconnect, automations and security checks, then writes a JSON report.
 *
 * Secrets (passwords, tokens) are NEVER printed to stdout or the report.
 *
 * Env overrides (defaults shown):
 *   PORT=4100 MQTT_PORT=11883 WS_PORT=4101
 *   DATABASE_URL=file:/tmp/aiot-e2e.db JWT_SECRET=e2e-test-secret
 *
 * Exit 0 only when every step passes.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mqtt from "mqtt";
import { WebSocket } from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const PORT = Number(process.env.PORT ?? 4100);
const MQTT_PORT = Number(process.env.MQTT_PORT ?? 11883);
const WS_PORT = Number(process.env.WS_PORT ?? 4101);
const DATABASE_URL = process.env.DATABASE_URL ?? "file:/tmp/aiot-e2e.db";
const JWT_SECRET = process.env.JWT_SECRET ?? "e2e-test-secret";
const API = `http://127.0.0.1:${PORT}/api`;
const DB_PATH = DATABASE_URL.startsWith("file:") ? DATABASE_URL.slice("file:".length) : DATABASE_URL;

// ------------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class E2EError extends Error {}

const results = [];
function record(n, title, status, evidence = "", error = "") {
  results.push({ step: n, title, status, evidence, error });
  const tag = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "SKIP";
  console.log(`[${tag}] step ${n}: ${title}${evidence ? ` — ${evidence}` : ""}${error ? `\n       error: ${error}` : ""}`);
}

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}

async function pollUntil(fn, { timeoutMs = 15000, intervalMs = 500, label = "" } = {}) {
  const start = Date.now();
  let lastErr;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() - start > timeoutMs) {
      throw new E2EError(`timeout waiting for ${label}${lastErr ? `: ${lastErr.message}` : ""}`);
    }
    await sleep(intervalMs);
  }
}

function spawnQuiet(cmd, args, { env, cwd } = {}) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd });
  child.stdout?.on("data", (d) => process.stderr.write(`[${cmd}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[${cmd}:err] ${d}`));
  return child;
}

function stopProcess(child, signal = "SIGTERM") {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    const done = () => resolve();
    child.once("exit", done);
    try {
      child.kill(signal);
    } catch {
      /* already dead */
    }
    setTimeout(done, 3000).unref?.();
  });
}

function killTree(child, signal = "SIGKILL") {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const done = () => resolve();
    child.once("exit", done);
    try {
      process.kill(child.pid, signal);
    } catch {
      /* already dead */
    }
    setTimeout(done, 3000).unref?.();
  });
}

/** WS client that collects events for one project. */
function openWs(token, projectId) {
  return new Promise((resolve, reject) => {
    const events = [];
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    const timer = setTimeout(() => reject(new E2EError("WS connect timeout")), 10000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", token }));
      ws.send(JSON.stringify({ type: "subscribe", projectId }));
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString("utf8"));
        if (msg?.type === "event" && msg.event) events.push(msg.event);
      } catch {
        /* ignore */
      }
    });
    ws.on("error", () => {});
    setTimeout(() => {
      clearTimeout(timer);
      resolve({ ws, events });
    }, 1500); // allow auth+subscribe handshake
  });
}

function waitForWsEvent(events, predicate, timeoutMs) {
  return pollUntil(
    () => events.find(predicate) ?? null,
    { timeoutMs, intervalMs: 250, label: "WS event" },
  );
}

// ------------------------------------------------------------------- state
const S = {
  backend: null,
  device: null,
  ws: null,
  wsEvents: [],
  token1: "",
  token2: "",
  viewerToken: "",
  orgId: "",
  projectId: "",
  deviceId: "",
  pairingUsername: "",
  pairingPassword: "",
  deviceToken: "",
  commandId: "",
};

function topic(kind) {
  return `aiot/v1/${S.orgId}/${S.projectId}/${S.deviceId}/${kind}`;
}

function startVirtualDevice(password) {
  if (S.device) throw new E2EError("virtual device already running");
  S.device = spawnQuiet(process.execPath, [
    join(ROOT, "packages/virtual-device/dist/cli.js"),
    "--broker",
    `mqtt://127.0.0.1:${MQTT_PORT}`,
    "--org",
    S.orgId,
    "--project",
    S.projectId,
    "--device",
    S.deviceId,
    "--username",
    S.pairingUsername,
    "--password",
    password,
    "--preset",
    "golden-room",
    "--tick",
    "500",
  ]);
  return S.device;
}

async function deviceStatus() {
  const r = await api("GET", `/devices/${S.deviceId}`, { token: S.token1 });
  if (r.status !== 200) throw new E2EError(`GET device returned ${r.status}`);
  return r.json;
}

// -------------------------------------------------------------------- steps
async function step1_startBackend() {
  if (existsSync(DB_PATH)) rmSync(DB_PATH);
  S.backend = spawnQuiet(process.execPath, [join(ROOT, "apps/backend/dist/index.js")], {
    cwd: ROOT,
    env: {
      PORT: String(PORT),
      MQTT_PORT: String(MQTT_PORT),
      WS_PORT: String(WS_PORT),
      DATABASE_URL,
      JWT_SECRET,
      SWEEP_INTERVAL_MS: "5000",
    },
  });
  await pollUntil(
    async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((x) => x.json());
      return r?.ok === true ? true : null;
    },
    { timeoutMs: 20000, intervalMs: 500, label: "backend /api/health" },
  );
  record(1, "start backend on fresh ports; /api/health -> {ok:true}", "PASS", `http=:${PORT} mqtt=:${MQTT_PORT} ws=:${WS_PORT}`);
}

async function step2_registerUser() {
  const r = await api("POST", "/auth/register", {
    body: { email: "e2e@test.local", password: "password123", name: "E2E" },
  });
  if (r.status !== 201) throw new E2EError(`register -> ${r.status}: ${JSON.stringify(r.json)}`);
  if (!r.json.token || !r.json.org?.id) throw new E2EError("register response missing token/org.id");
  S.token1 = r.json.token;
  S.orgId = r.json.org.id;
  record(2, "register user -> token + orgId", "PASS", "user e2e@test.local registered; org created (ids kept in report)");
}

async function step3_createProject() {
  const r = await api("POST", `/orgs/${S.orgId}/projects`, {
    token: S.token1,
    body: { name: "Golden Room" },
  });
  if (r.status !== 201 || !r.json.project?.id) throw new E2EError(`create project -> ${r.status}`);
  S.projectId = r.json.project.id;
  record(3, "create project 'Golden Room'", "PASS", "project created (id kept in report)");
}

async function step4_createDevice() {
  const r = await api("POST", `/projects/${S.projectId}/devices`, {
    token: S.token1,
    body: { name: "Golden Room Device", type: "environment", model: "golden-room-v1" },
  });
  if (r.status !== 201) throw new E2EError(`create device -> ${r.status}: ${JSON.stringify(r.json)}`);
  const { device, pairing } = r.json;
  if (!device?.deviceId?.startsWith("DEV-")) throw new E2EError("deviceId not DEV-XXXXX");
  if (!pairing?.username || !pairing?.password) throw new E2EError("pairing creds missing");
  S.deviceId = device.deviceId;
  S.pairingUsername = pairing.username;
  S.pairingPassword = pairing.password; // shown once; kept in memory, never logged
  record(4, "create device -> DEV-XXXXX + one-time pairing creds", "PASS", `deviceId=${S.deviceId} username=${S.pairingUsername}`);
}

async function step5_startVirtualDevice() {
  startVirtualDevice(S.pairingPassword);
  await sleep(5000);
  record(5, "start virtual device (golden-room, tick 500ms); wait 5s", "PASS", "process spawned");
}

async function step6_deviceOnline() {
  const info = await pollUntil(
    async () => {
      const d = await deviceStatus();
      return d.device.status === "ONLINE" ? d : null;
    },
    { timeoutMs: 15000, label: "device ONLINE" },
  );
  const caps = (info.capabilities ?? []).map((c) => c.id ?? c.capabilityId);
  for (const need of ["temperature", "humidity", "fan"]) {
    if (!caps.includes(need)) throw new E2EError(`capability ${need} missing (have: ${caps.join(",")})`);
  }
  record(6, "device ONLINE with temperature/humidity/fan capabilities", "PASS", `caps: ${caps.join(",")}`);
}

async function step7_pair() {
  const r = await api("POST", "/pair", {
    token: S.token1,
    body: { deviceId: S.deviceId, username: S.pairingUsername, password: S.pairingPassword },
  });
  if (r.status !== 200 || r.json.ok !== true || !r.json.deviceToken) {
    throw new E2EError(`pair -> ${r.status}: ${JSON.stringify(r.json)}`);
  }
  S.deviceToken = r.json.deviceToken; // new operational credential; never logged
  record(
    7,
    "pair via API -> deviceToken (rotation: old pairing creds revoked)",
    "PASS",
    `ok=${r.json.ok} rotated=${r.json.rotated === true}`,
  );
}
async function step8_rotation() {
  // Old pairing password must no longer work (pairing row consumed/revoked).
  const r = await api("POST", "/pair", {
    token: S.token1,
    body: { deviceId: S.deviceId, username: S.pairingUsername, password: S.pairingPassword },
  });
  if (r.status >= 200 && r.status < 300) throw new E2EError(`pair with old password unexpectedly succeeded`);
  // Restart the virtual device with the NEW device token (same username).
  await killTree(S.device, "SIGKILL");
  S.device = null;
  startVirtualDevice(S.deviceToken);
  await pollUntil(
    async () => (await deviceStatus()).device.status === "ONLINE" || null,
    { timeoutMs: 15000, label: "device ONLINE with rotated token" },
  );
  record(
    8,
    "rotation: old pairing password rejected; device reconnects with new token and is ONLINE",
    "PASS",
    `old-password pair rejected with HTTP ${r.status}; reconnected ONLINE`,
  );
}

async function step9_authzIsolation() {
  const r2 = await api("POST", "/auth/register", {
    body: { email: "e2e-attacker@test.local", password: "password123", name: "Attacker" },
  });
  if (r2.status !== 201) throw new E2EError(`second register -> ${r2.status}`);
  S.token2 = r2.json.token;
  const g = await api("GET", `/devices/${S.deviceId}`, { token: S.token2 });
  if (g.status !== 404) throw new E2EError(`cross-org device GET -> ${g.status}, expected 404`);
  const c = await api("POST", `/devices/${S.deviceId}/commands`, {
    token: S.token2,
    body: { capabilityId: "fan", action: "set", params: { value: true } },
  });
  if (c.status !== 403 && c.status !== 404) {
    throw new E2EError(`cross-org command POST -> ${c.status}, expected 403/404`);
  }
  record(9, "authz isolation: second user sees 404 on device and cannot command", "PASS", `GET device -> 404; POST command -> ${c.status}`);
}

async function step10_telemetry() {
  const rows = await pollUntil(
    async () => {
      const r = await api("GET", `/devices/${S.deviceId}/telemetry?limit=5`, { token: S.token1 });
      if (r.status !== 200) throw new E2EError(`telemetry -> ${r.status}`);
      const list = r.json.telemetry ?? r.json.rows ?? [];
      return list.length > 0 ? list : null;
    },
    { timeoutMs: 20000, label: "telemetry rows" },
  );
  const latest = rows[0];
  const values = latest.values ?? {};
  const t = values.temperature;
  const h = values.humidity;
  if (typeof t !== "number" || t < 22 || t > 28) throw new E2EError(`temperature out of range: ${t}`);
  if (typeof h !== "number" || h < 47 || h > 63) throw new E2EError(`humidity out of range: ${h}`);
  const mid = latest.messageId ?? "";
  if (typeof mid !== "string" || !mid.includes(S.deviceId)) {
    throw new E2EError(`invalid messageId: ${JSON.stringify(mid)}`);
  }
  record(
    10,
    "telemetry rows with in-range values and valid messageIds",
    "PASS",
    `${rows.length} rows; temp=${t} hum=${h}; messageId present`,
  );
}

async function step11_realtime() {
  const { ws, events } = await openWs(S.token1, S.projectId);
  S.ws = ws;
  S.wsEvents = events;
  const ev = await waitForWsEvent(
    events,
    (e) => e.kind === "device.telemetry" && e.deviceId === S.deviceId,
    15000,
  );
  record(11, "realtime WS: device.telemetry event received within 15s", "PASS", `event at=${ev.at}`);
}

async function step12_command() {
  const r = await api("POST", `/devices/${S.deviceId}/commands`, {
    token: S.token1,
    body: { capabilityId: "fan", action: "set", params: { value: true }, ttlMs: 30000 },
  });
  if (r.status !== 201 || !r.json.command?.commandId) {
    throw new E2EError(`create command -> ${r.status}: ${JSON.stringify(r.json)}`);
  }
  S.commandId = r.json.command.commandId;
  const final = await pollUntil(
    async () => {
      const lr = await api("GET", `/devices/${S.deviceId}/commands?limit=10`, { token: S.token1 });
      const found = (lr.json.commands ?? []).find((c) => c.commandId === S.commandId);
      if (!found) throw new E2EError("command vanished from list");
      return ["SUCCEEDED", "FAILED", "EXPIRED", "REJECTED"].includes(found.status) ? found : null;
    },
    { timeoutMs: 20000, label: "command terminal state" },
  );
  if (final.status !== "SUCCEEDED") throw new E2EError(`command ended ${final.status}`);
  if (final.result?.reportedState?.fan !== true) {
    throw new E2EError(`reportedState.fan !== true: ${JSON.stringify(final.result)}`);
  }
  const ack = await waitForWsEvent(
    S.wsEvents,
    (e) => e.kind === "command.acknowledged" && e.data?.commandId === S.commandId,
    10000,
  );
  record(
    12,
    "command fan=set(true) -> SUCCEEDED, reportedState.fan=true, WS command.acknowledged",
    "PASS",
    `commandId=${S.commandId} status=SUCCEEDED; ws ack status=${ack.data.status}`,
  );
}

async function step13_safety() {
  // (a) Backend validation: nonsense param must 400.
  const bad = await api("POST", `/devices/${S.deviceId}/commands`, {
    token: S.token1,
    body: { capabilityId: "fan", action: "set", params: { value: "banana" }, ttlMs: 30000 },
  });
  if (bad.status !== 400 || bad.json.error !== "invalid_parameter") {
    throw new E2EError(`banana param -> ${bad.status}: ${JSON.stringify(bad.json)}`);
  }

  // (b) Device-side expiry: publish a raw MQTT command that is already expired.
  // The virtual device must reject it with an EXPIRED result and never actuate.
  const before = await api("GET", `/devices/${S.deviceId}/commands?limit=50`, { token: S.token1 });
  const expiredBefore = (before.json.commands ?? []).filter((c) => c.status === "EXPIRED").length;

  const client = mqtt.connect(`mqtt://127.0.0.1:${MQTT_PORT}`, {
    username: S.pairingUsername,
    password: S.deviceToken,
    clientId: `e2e-expiry-probe-${Date.now()}`,
    reconnectPeriod: 0,
  });
  await new Promise((res, rej) => {
    client.once("connect", res);
    client.once("error", rej);
    setTimeout(() => rej(new E2EError("mqtt connect timeout (expiry probe)")), 8000);
  });
  const expiredResult = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new E2EError("no EXPIRED result within 5s")), 5000);
    client.subscribe(topic("command"), (err) => err && reject(err));
    client.on("message", (t, payload) => {
      try {
        const m = JSON.parse(payload.toString("utf8"));
        if (m.kind === "result" && m.commandId === "cmd_exp1") {
          clearTimeout(timer);
          resolve(m);
        }
      } catch {
        /* ignore */
      }
    });
    const now = Date.now();
    client.publish(
      topic("command"),
      JSON.stringify({
        kind: "command",
        protocolVersion: "1.0",
        commandId: "cmd_exp1",
        deviceId: S.deviceId,
        capabilityId: "fan",
        action: "set",
        params: { value: false },
        issuedAt: now - 60000,
        expiresAt: now - 1000,
      }),
    );
  });
  client.end(true);
  if (expiredResult.status !== "EXPIRED") {
    throw new E2EError(`expected EXPIRED, got ${expiredResult.status}`);
  }
  await sleep(2000);
  const after = await api("GET", `/devices/${S.deviceId}/commands?limit=50`, { token: S.token1 });
  const expiredAfter = (after.json.commands ?? []).filter((c) => c.status === "EXPIRED").length;
  if (expiredAfter !== expiredBefore) {
    throw new E2EError("backend recorded a phantom EXPIRED row for an unknown commandId");
  }
  // Fan must still be on (the expired command must not have actuated).
  const dev = await deviceStatus();
  if (dev.state?.reported?.fan !== true) {
    throw new E2EError(`fan flipped by expired command: ${JSON.stringify(dev.state?.reported)}`);
  }
  record(
    13,
    "safety: 400 invalid_parameter; expired raw MQTT command -> device EXPIRED result, no actuation, no phantom backend row",
    "PASS",
    `banana -> 400; device result status=EXPIRED; fan still true`,
  );
}

async function step14_disconnect() {
  S.wsEvents.length = 0;
  await killTree(S.device, "SIGKILL");
  S.device = null;
  const info = await pollUntil(
    async () => {
      const d = await deviceStatus();
      return d.device.status === "OFFLINE" ? d : null;
    },
    { timeoutMs: 15000, label: "device OFFLINE after SIGKILL (LWT)" },
  );
  const ev = await waitForWsEvent(
    S.wsEvents,
    (e) => e.kind === "device.offline" && e.deviceId === S.deviceId,
    10000,
  );
  record(14, "SIGKILL -> LWT -> OFFLINE + WS device.offline", "PASS", `status=${info.device.status}; ws event at=${ev.at}`);
}

async function step15_reconnect() {
  S.wsEvents.length = 0;
  startVirtualDevice(S.deviceToken);
  await pollUntil(
    async () => (await deviceStatus()).device.status === "ONLINE" || null,
    { timeoutMs: 15000, label: "device ONLINE after reconnect" },
  );
  const ev = await waitForWsEvent(
    S.wsEvents,
    (e) => e.kind === "device.online" && e.deviceId === S.deviceId,
    10000,
  );
  record(15, "reconnect with current token -> ONLINE + WS device.online", "PASS", `ws event at=${ev.at}`);
}

async function step16_automation() {
  const r = await api("POST", `/projects/${S.projectId}/automations`, {
    token: S.token1,
    body: {
      name: "heat-fan",
      deviceId: S.deviceId,
      enabled: true,
      condition: { capabilityId: "temperature", operator: ">", value: 10 },
      action: { capabilityId: "fan", action: "set", params: { value: true } },
    },
  });
  if (r.status !== 201 || !r.json.automation?.id) {
    throw new E2EError(`create automation -> ${r.status}: ${JSON.stringify(r.json)}`);
  }
  const autoId = r.json.automation.id;
  const triggered = await pollUntil(
    async () => {
      const lr = await api("GET", `/devices/${S.deviceId}/commands?limit=20`, { token: S.token1 });
      return (lr.json.commands ?? []).find((c) => String(c.createdBy).startsWith("automation:")) ?? null;
    },
    { timeoutMs: 30000, label: "automation-triggered command" },
  );
  const del = await api("DELETE", `/projects/${S.projectId}/automations/${autoId}`, { token: S.token1 });
  if (del.status !== 200 && del.status !== 204) throw new E2EError(`delete automation -> ${del.status}`);
  record(
    16,
    "automation (temp>10 -> fan on) fires on telemetry ingest; rule deleted",
    "PASS",
    `triggered command ${triggered.commandId} createdBy=${triggered.createdBy}; deleted`,
  );
}

// ------------------------------------------------------- security checks
async function secA_viewerCannotCommand() {
  const rv = await api("POST", "/auth/register", {
    body: { email: "e2e-viewer@test.local", password: "password123", name: "Viewer" },
  });
  if (rv.status !== 201) throw new E2EError(`viewer register -> ${rv.status}`);
  S.viewerToken = rv.json.token;
  const m = await api("POST", `/orgs/${S.orgId}/members`, {
    token: S.token1,
    body: { email: "e2e-viewer@test.local", role: "VIEWER" },
  });
  if (m.status !== 200) throw new E2EError(`add viewer member -> ${m.status}: ${JSON.stringify(m.json)}`);
  const c = await api("POST", `/devices/${S.deviceId}/commands`, {
    token: S.viewerToken,
    body: { capabilityId: "fan", action: "set", params: { value: true } },
  });
  if (c.status !== 403) throw new E2EError(`viewer command -> ${c.status}, expected 403`);
  record("S1", "security: VIEWER member gets 403 on command POST", "PASS", "POST command -> 403");
}

async function secB_rateLimit() {
  let n429 = 0;
  for (let i = 0; i < 40; i++) {
    const r = await api("POST", "/auth/login", {
      body: { email: "e2e@test.local", password: "wrong-password" },
    });
    if (r.status === 429) n429++;
    else if (r.status !== 401) throw new E2EError(`unexpected login status ${r.status}`);
  }
  if (n429 === 0) throw new E2EError("no 429 responses during 40x burst");
  record("S2", "security: 40x wrong-password login burst -> rate limited", "PASS", `${n429}/40 requests got HTTP 429`);
}

// ------------------------------------------------------------------ main
async function cleanup() {
  try {
    S.ws?.close();
  } catch {
    /* ignore */
  }
  await stopProcess(S.device, "SIGTERM");
  await stopProcess(S.backend, "SIGTERM");
}

async function main() {
  const t0 = Date.now();
  const steps = [
    step1_startBackend,
    step2_registerUser,
    step3_createProject,
    step4_createDevice,
    step5_startVirtualDevice,
    step6_deviceOnline,
    step7_pair,
    step8_rotation,
    step9_authzIsolation,
    step10_telemetry,
    step11_realtime,
    step12_command,
    step13_safety,
    step14_disconnect,
    step15_reconnect,
    step16_automation,
    secA_viewerCannotCommand,
    secB_rateLimit, // last: it burns the auth rate-limit budget
  ];
  let failed = false;
  for (const fn of steps) {
    if (failed) break;
    try {
      await fn();
    } catch (e) {
      failed = true;
      const msg = e instanceof E2EError ? e.message : `unexpected: ${e?.stack ?? e}`;
      const title = fn.name.replace(/^step\d+_|^sec[A-Z]_/, "");
      record(results.length + 1, title, "FAIL", "", msg);
      break;
    }
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  const failedCount = results.filter((r) => r.status === "FAIL").length;
  const summary = {
    startedAt: new Date(t0).toISOString(),
    durationMs: Date.now() - t0,
    config: { port: PORT, mqttPort: MQTT_PORT, wsPort: WS_PORT, databaseUrl: "<redacted-for-report>" },
    total: steps.length,
    passed,
    failed: failedCount,
    results: results.map(({ error, ...rest }) => ({ ...rest, error: error || undefined })),
  };
  const outDir = join(ROOT, "tests", "e2e");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(summary, null, 2));
  console.log(`\nE2E ${failed ? "FAILED" : "PASSED"}: ${passed}/${steps.length} steps in ${(Date.now() - t0) / 1000}s`);
  console.log(`report: ${join(outDir, "report.json")}`);
  await cleanup();
  process.exit(failed ? 1 : 0);
}

process.on("unhandledRejection", (e) => {
  console.error("unhandled rejection:", e);
  cleanup().finally(() => process.exit(2));
});

await main();
