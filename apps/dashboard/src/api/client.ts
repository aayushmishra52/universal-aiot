/**
 * Typed HTTP client for the @aiot/backend REST API.
 * Token is persisted in localStorage; base URL comes from VITE_API_URL.
 */

import type {
  Automation,
  AutomationAction,
  AutomationCondition,
  Capability,
  Health,
  RealtimeEvent,
  UserRole,
} from "@aiot/contracts";

export type { Automation, Health } from "@aiot/contracts";

export const API_BASE =
  (import.meta.env.VITE_API_URL ?? "http://localhost:4000")
    .replace(/\/+$/, "")
    .replace(/\/api$/, "") + "/api";
const TOKEN_KEY = "aiot.auth.token";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/* ---------- token storage ---------- */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/* ---------- low-level fetch ---------- */
async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, `Network error: could not reach ${API_BASE}`);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    const msg =
      (data as { message?: string; error?: string } | null)?.message ??
      (data as { message?: string; error?: string } | null)?.error ??
      `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/* ---------- domain types ---------- */
export interface Org {
  id: string;
  name: string;
  role?: UserRole;
}
export interface User {
  id: string;
  email: string;
  name: string;
}
export interface Project {
  id: string;
  name: string;
}
export interface DeviceSummary {
  deviceId: string;
  name: string;
  type?: string;
  model?: string;
  firmwareVersion?: string;
  status: string;
  lastSeen?: number;
  capabilityCount?: number;
}
export interface DeviceState {
  desired: Record<string, unknown>;
  reported: Record<string, unknown>;
}
export interface DeviceDetail {
  device: DeviceSummary & {
    orgId?: string;
    projectId?: string;
    type?: string;
  };
  capabilities: Capability[];
  state: DeviceState;
  health?: Health | null;
}
export interface PairingBundle {
  device: DeviceSummary;
  pairing: { deviceId: string; username: string; password: string };
}
export interface PairResult {
  ok: boolean;
  deviceId: string;
  projectId: string;
  orgId: string;
  rotated: boolean;
  deviceToken: string;
}
export interface TelemetryPoint {
  ts: number;
  seq: number;
  messageId: string;
  values: Record<string, number | string | boolean>;
  quality?: string;
}
export interface CommandRecord {
  commandId: string;
  capabilityId: string;
  action: string;
  params: Record<string, unknown>;
  issuedAt: number;
  expiresAt: number;
  status: string;
  result?: { status: string; reason?: string; at: number };
}
export interface AutomationInput {
  name: string;
  deviceId?: string;
  enabled: boolean;
  condition: AutomationCondition;
  action: AutomationAction;
}

/* ---------- auth ---------- */
export async function register(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ token: string; user: User; org: Org }> {
  return request("/api/auth/register", { method: "POST", body: input, auth: false });
}
export async function login(input: {
  email: string;
  password: string;
}): Promise<{ token: string; user: User; orgs: Org[] }> {
  return request("/api/auth/login", { method: "POST", body: input, auth: false });
}
export async function me(): Promise<{ user: User; orgs: Org[] }> {
  return request("/api/auth/me");
}

/* ---------- orgs & projects ---------- */
export async function createOrg(name: string): Promise<Org> {
  return request("/api/orgs", { method: "POST", body: { name } });
}
export async function listOrgs(): Promise<Org[]> {
  return request("/api/orgs");
}
export async function listProjects(orgId: string): Promise<Project[]> {
  return request(`/api/orgs/${orgId}/projects`);
}
export async function createProject(orgId: string, name: string): Promise<Project> {
  return request(`/api/orgs/${orgId}/projects`, { method: "POST", body: { name } });
}

/* ---------- devices ---------- */
export async function listDevices(projectId: string): Promise<DeviceSummary[]> {
  return request(`/api/projects/${projectId}/devices`);
}
export async function createDevice(
  projectId: string,
  input: { name: string; type?: string; model?: string },
): Promise<PairingBundle> {
  return request(`/api/projects/${projectId}/devices`, {
    method: "POST",
    body: input,
  });
}
export async function getDevice(deviceId: string): Promise<DeviceDetail> {
  return request(`/api/devices/${deviceId}`);
}
export async function deleteDevice(deviceId: string): Promise<void> {
  await request(`/api/devices/${deviceId}`, { method: "DELETE" });
}
export async function pairDevice(input: {
  deviceId: string;
  username: string;
  password: string;
}): Promise<PairResult> {
  return request("/api/pair", { method: "POST", body: input });
}
export async function rotateCredentials(
  deviceId: string,
): Promise<{ deviceToken: string }> {
  return request(`/api/devices/${deviceId}/credentials/rotate`, { method: "POST" });
}

/* ---------- telemetry & commands ---------- */
export async function getTelemetry(
  deviceId: string,
  opts: { capability?: string; limit?: number } = {},
): Promise<TelemetryPoint[]> {
  const q = new URLSearchParams();
  if (opts.capability) q.set("capability", opts.capability);
  if (opts.limit) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return request(`/api/devices/${deviceId}/telemetry${qs ? `?${qs}` : ""}`);
}
export async function listCommands(
  deviceId: string,
  limit = 50,
): Promise<CommandRecord[]> {
  return request(`/api/devices/${deviceId}/commands?limit=${limit}`);
}
export async function sendCommand(
  deviceId: string,
  input: {
    capabilityId: string;
    action?: string;
    params: Record<string, unknown>;
    ttlMs?: number;
  },
): Promise<CommandRecord> {
  return request(`/api/devices/${deviceId}/commands`, {
    method: "POST",
    body: { action: "set", ...input },
  });
}

/* ---------- automations ---------- */
export async function listAutomations(projectId: string): Promise<Automation[]> {
  return request(`/api/projects/${projectId}/automations`);
}
export async function createAutomation(
  projectId: string,
  input: AutomationInput,
): Promise<Automation> {
  return request(`/api/projects/${projectId}/automations`, {
    method: "POST",
    body: input,
  });
}
export async function updateAutomation(
  projectId: string,
  automationId: string,
  input: Partial<AutomationInput>,
): Promise<Automation> {
  return request(`/api/projects/${projectId}/automations/${automationId}`, {
    method: "PATCH",
    body: input,
  });
}
export async function deleteAutomation(
  projectId: string,
  automationId: string,
): Promise<void> {
  await request(`/api/projects/${projectId}/automations/${automationId}`, {
    method: "DELETE",
  });
}

export type { RealtimeEvent };
