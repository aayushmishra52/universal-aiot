/**
 * Device credential lifecycle: issuance, metadata listing, revocation, and
 * MQTT authentication (valid / wrong / revoked / cross-device isolation).
 *
 * Real end-to-end: HTTP API against a live Fastify server + real MQTT
 * connects through the embedded aedes broker. Secrets are generated at
 * runtime; nothing hardcoded.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { topicTelemetry } from "@aiot/contracts";
import {
  startTestServer,
  api,
  provisionDevice,
  connectDevice,
  publishTelemetry,
  waitFor,
  sleep,
  type ServerHandles,
} from "./helpers.js";

let server: ServerHandles;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

interface Issued {
  id: string;
  clientId: string;
  secret: string;
  label: string | null;
  scopes: string[];
  createdAt: number;
}

async function issue(
  token: string,
  deviceId: string,
  body: Record<string, unknown> = {},
) {
  return api(server.httpUrl, token)(
    "POST",
    `/api/devices/${deviceId}/credentials`,
    body,
  );
}

describe("device credentials", () => {
  it("issues a credential and returns the plaintext secret exactly once", async () => {
    const { device } = await provisionDevice(server, "creduser1", "cred-1");
    const res = await issue(device.token, device.deviceId, { label: "field unit" });
    expect(res.status).toBe(201);
    const issued = res.json as Issued;
    expect(issued.id).toBeTruthy();
    expect(issued.clientId).toMatch(/^dc_[A-Za-z0-9]{16}$/);
    expect(issued.secret).toHaveLength(48);
    expect(issued.label).toBe("field unit");
    expect(issued.scopes).toEqual(["telemetry", "commands"]);
    expect(issued.createdAt).toBeGreaterThan(0);

    // Only the bcrypt hash is stored — never the plaintext.
    const row = server.db
      .prepare("SELECT password_hash, client_id FROM device_credentials WHERE id = ?")
      .get(issued.id) as { password_hash: string; client_id: string };
    expect(row.client_id).toBe(issued.clientId);
    expect(row.password_hash).not.toContain(issued.secret);
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);

    // The list endpoint never exposes the secret or the hash, even right
    // after issuance.
    const list = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}/credentials`,
    );
    expect(list.status).toBe(200);
    const dumped = JSON.stringify(list.json);
    expect(dumped).not.toContain(issued.secret);
    expect(dumped).not.toContain("password_hash");
    expect(dumped).not.toContain("passwordHash");
    const meta = list.json.credentials.find(
      (c: { id: string }) => c.id === issued.id,
    );
    expect(meta).toMatchObject({
      id: issued.id,
      clientId: issued.clientId,
      label: "field unit",
      scopes: ["telemetry", "commands"],
      revokedAt: null,
    });
    expect(meta.secret).toBeUndefined();
  });

  it("supports custom scopes and labels", async () => {
    const { device } = await provisionDevice(server, "creduser2", "cred-2");
    const res = await issue(device.token, device.deviceId, {
      label: "telemetry only",
      scopes: ["telemetry"],
    });
    expect(res.status).toBe(201);
    expect(res.json.scopes).toEqual(["telemetry"]);
    const bad = await issue(device.token, device.deviceId, { scopes: [] });
    expect(bad.status).toBe(400);
  });

  it("revokes a credential; the row is kept with revoked_at set", async () => {
    const { device } = await provisionDevice(server, "creduser3", "cred-3");
    const res = await issue(device.token, device.deviceId, { label: "doomed" });
    const issued = res.json as Issued;

    const del = await api(server.httpUrl, device.token)(
      "DELETE",
      `/api/devices/${device.deviceId}/credentials/${issued.id}`,
    );
    expect(del.status).toBe(200);
    expect(del.json.ok).toBe(true);

    const list = await api(server.httpUrl, device.token)(
      "GET",
      `/api/devices/${device.deviceId}/credentials`,
    );
    const meta = list.json.credentials.find(
      (c: { id: string }) => c.id === issued.id,
    );
    expect(meta.revokedAt).toBeGreaterThan(0);

    // A revoked credential no longer authenticates over MQTT.
    const outcome = await connectDevice(server, issued.clientId, issued.secret).then(
      async (c) => {
        await c.endAsync();
        return "connected";
      },
      () => "rejected",
    );
    expect(outcome).toBe("rejected");
  });

  it("returns 404 when revoking a credential of another device", async () => {
    const a = await provisionDevice(server, "creduser4a", "cred-4a");
    const b = await provisionDevice(server, "creduser4b", "cred-4b");
    const res = await issue(b.device.token, b.device.deviceId);
    const del = await api(server.httpUrl, a.device.token)(
      "DELETE",
      `/api/devices/${a.device.deviceId}/credentials/${res.json.id}`,
    );
    expect(del.status).toBe(404);
  });

  it("requires authentication for credential management", async () => {
    const { device } = await provisionDevice(server, "creduser5", "cred-5");
    const res = await api(server.httpUrl)(
      "POST",
      `/api/devices/${device.deviceId}/credentials`,
      {},
    );
    expect(res.status).toBe(401);
  });

  it("authenticates MQTT with a valid credential and records last_used_at", async () => {
    const { device } = await provisionDevice(server, "creduser6", "cred-6");
    const res = await issue(device.token, device.deviceId, { label: "mqtt" });
    const issued = res.json as Issued;

    const before = server.db
      .prepare("SELECT last_used_at FROM device_credentials WHERE id = ?")
      .get(issued.id) as { last_used_at: number | null };
    expect(before.last_used_at).toBeNull();

    const client = await connectDevice(server, issued.clientId, issued.secret);
    await client.endAsync();

    await waitFor(() => {
      const row = server.db
        .prepare("SELECT last_used_at FROM device_credentials WHERE id = ?")
        .get(issued.id) as { last_used_at: number | null };
      return row.last_used_at !== null;
    });
    const after = server.db
      .prepare("SELECT last_used_at FROM device_credentials WHERE id = ?")
      .get(issued.id) as { last_used_at: number };
    expect(after.last_used_at).toBeGreaterThan(0);
  });

  it("rejects MQTT auth with the wrong secret", async () => {
    const { device } = await provisionDevice(server, "creduser7", "cred-7");
    const res = await issue(device.token, device.deviceId);
    const issued = res.json as Issued;
    const outcome = await connectDevice(server, issued.clientId, `wrong-${issued.secret}`).then(
      () => "connected",
      () => "rejected",
    );
    expect(outcome).toBe("rejected");
  });

  it("lets a device publish to its own topics but not to another device's", async () => {
    const a = await provisionDevice(server, "creduser8a", "cred-8a");
    const b = await provisionDevice(server, "creduser8b", "cred-8b");
    const res = await issue(a.device.token, a.device.deviceId);
    const issued = res.json as Issued;

    const client = await connectDevice(server, issued.clientId, issued.secret);

    // Positive control: own telemetry topic is accepted and ingested.
    await publishTelemetry(client, a.device.orgId, a.device.projectId, a.device.deviceId, {
      temp: 22.5,
    });
    await waitFor(() => {
      const row = server.db
        .prepare("SELECT COUNT(*) AS n FROM telemetry WHERE device_id_fk = ?")
        .get(a.device.deviceId) as { n: number };
      return row.n > 0;
    });

    // Cross-device publish: the broker drops it (authorizePublish rejects
    // anything outside aiot/v1/{org}/{project}/{device}/#). QoS 0 so the
    // client isn't left waiting on a PUBACK that will never come.
    await client.publishAsync(
      topicTelemetry(b.device.orgId, b.device.projectId, b.device.deviceId),
      JSON.stringify({ temp: 99 }),
      { qos: 0 },
    );
    await sleep(800);
    const leaked = server.db
      .prepare("SELECT COUNT(*) AS n FROM telemetry WHERE device_id_fk = ?")
      .get(b.device.deviceId) as { n: number };
    expect(leaked.n).toBe(0);

    await client.endAsync();
  }, 30000);

  it("keeps the legacy rotate endpoint working", async () => {
    const { device } = await provisionDevice(server, "creduser9", "cred-9");
    const rotated = await api(server.httpUrl, device.token)(
      "POST",
      `/api/devices/${device.deviceId}/credentials/rotate`,
    );
    expect(rotated.status).toBe(200);
    expect(rotated.json.deviceToken).toHaveLength(32);
    // The rotated token authenticates over MQTT under the legacy username.
    const client = await connectDevice(
      server,
      rotated.json.username,
      rotated.json.deviceToken,
    );
    await client.endAsync();
  });
});
