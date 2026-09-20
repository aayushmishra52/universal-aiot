import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  connectDevice,
  deviceUsername,
  provisionDevice,
  publishTelemetry,
  registerUser,
  startTestServer,
  type ServerHandles,
} from "./helpers.js";

let server: ServerHandles;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

function wsUrl(): string {
  return `ws://127.0.0.1:${server.wsPort}`;
}

/** Open a socket and wait for the first message or close. */
function firstMessage(ws: WebSocket): Promise<{ kind: "message" | "close"; data: string }> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve({ kind: "message", data: data.toString() }));
    ws.once("close", (code) => resolve({ kind: "close", data: String(code) }));
  });
}

async function authedSocket(token: string): Promise<WebSocket> {
  const ws = new WebSocket(wsUrl());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });
  ws.send(JSON.stringify({ type: "auth", token }));
  const first = await firstMessage(ws);
  expect(first.kind).toBe("message");
  expect(JSON.parse(first.data)).toMatchObject({ type: "auth_ok" });
  return ws;
}

describe("realtime", () => {
  it("closes sockets that never authenticate", async () => {
    const ws = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    ws.send(JSON.stringify({ type: "subscribe", projectId: "whatever" }));
    const first = await firstMessage(ws);
    expect(first.kind).toBe("close");
    expect(first.data).toBe("4401");
  });

  it("rejects invalid tokens", async () => {
    const ws = new WebSocket(wsUrl());
    await new Promise<void>((resolve) => ws.once("open", () => resolve()));
    ws.send(JSON.stringify({ type: "auth", token: "bogus" }));
    const first = await firstMessage(ws);
    expect(first.kind).toBe("close");
    expect(first.data).toBe("4401");
  });

  it("delivers project events to subscribed members", async () => {
    const { device, project } = await provisionDevice(server, "rtuser", "rt-1");
    const ws = await authedSocket(device.token);
    try {
      ws.send(JSON.stringify({ type: "subscribe", projectId: project.id }));
      const sub = await firstMessage(ws);
      expect(JSON.parse(sub.data)).toMatchObject({ type: "subscribed", projectId: project.id });

      const events: any[] = [];
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "event") events.push(msg.event);
      });

      const client = await connectDevice(
        server,
        deviceUsername(device.deviceId),
        device.deviceToken,
      );
      try {
        await publishTelemetry(client, device.orgId, device.projectId, device.deviceId, {
          temp: 22.5,
        });
      } finally {
        await client.endAsync();
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for event")), 5000);
        const check = setInterval(() => {
          if (events.some((e) => e.kind === "device.telemetry")) {
            clearTimeout(timer);
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
      const telemetry = events.find((e) => e.kind === "device.telemetry");
      expect(telemetry.deviceId).toBe(device.deviceId);
    } finally {
      ws.close();
    }
  });

  it("refuses subscriptions to projects outside the member's orgs", async () => {
    const a = await provisionDevice(server, "rtuserA", "rt-a");
    const b = await registerUser(server, "Rt B", "rtb@example.com", "password123");
    const ws = await authedSocket(b.token);
    try {
      ws.send(JSON.stringify({ type: "subscribe", projectId: a.project.id }));
      const reply = await firstMessage(ws);
      expect(reply.kind).toBe("message");
      expect(JSON.parse(reply.data)).toMatchObject({ type: "error", error: "forbidden" });

      // No events leak to the non-member either.
      let leaked = false;
      ws.on("message", (data) => {
        if (JSON.parse(data.toString()).type === "event") leaked = true;
      });
      const client = await connectDevice(
        server,
        deviceUsername(a.device.deviceId),
        a.device.deviceToken,
      );
      try {
        await publishTelemetry(client, a.device.orgId, a.device.projectId, a.device.deviceId, {
          temp: 23,
        });
      } finally {
        await client.endAsync();
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(leaked).toBe(false);
    } finally {
      ws.close();
    }
  });
});
