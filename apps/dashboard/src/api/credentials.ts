/**
 * Device credential management API.
 *
 * NOTE: `request` is module-private in ./client.js (owned by another work
 * stream), so this module ships an identical local fetch helper built on the
 * exported API_BASE / getToken / ApiError primitives.
 */
import { API_BASE, getToken, ApiError } from "./client.js";

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = "GET", body } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
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

export interface CredentialMeta {
  id: string;
  clientId: string;
  label: string | null;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** The plaintext `secret` is returned exactly once at issuance. */
export interface IssuedCredential extends CredentialMeta {
  secret: string;
}

export async function provisionCredentials(
  deviceId: string,
  input: { label?: string; scopes?: string[] } = {},
): Promise<IssuedCredential> {
  return request<IssuedCredential>(`/api/devices/${deviceId}/credentials`, {
    method: "POST",
    body: input,
  });
}

export async function listCredentials(deviceId: string): Promise<CredentialMeta[]> {
  const res = await request<{ credentials: CredentialMeta[] }>(
    `/api/devices/${deviceId}/credentials`,
  );
  return res.credentials;
}

export async function revokeCredential(
  deviceId: string,
  credId: string,
): Promise<void> {
  await request(`/api/devices/${deviceId}/credentials/${credId}`, {
    method: "DELETE",
  });
}
