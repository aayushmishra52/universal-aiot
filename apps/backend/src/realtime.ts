import { WebSocket, WebSocketServer } from "ws";
import type { Database } from "better-sqlite3";
import type { RealtimeEvent } from "@aiot/contracts";
import { verifyToken } from "./auth/jwt.js";
import { getOrgRole } from "./authz.js";
import type { AppConfig } from "./config.js";

const AUTH_TIMEOUT_MS = 5000;

interface Client {
  ws: WebSocket;
  userId?: string;
  authed: boolean;
  projects: Set<string>;
}

export interface RealtimeHandles {
  port: number;
  close: () => Promise<void>;
}

// Module-level registry: one server per process. broadcastRealtime() fans out
// to every authenticated socket subscribed to the event's project.
const clients = new Set<Client>();

/** Broadcast a realtime event to subscribed sockets of its project. */
export function broadcastRealtime(event: RealtimeEvent): void {
  const message = JSON.stringify({ type: "event", event });
  for (const client of clients) {
    if (
      client.authed &&
      client.projects.has(event.projectId) &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      try {
        client.ws.send(message);
      } catch {
        // A dead socket must not break the broadcast loop.
      }
    }
  }
}

/**
 * Start the realtime WebSocket server.
 *
 * Protocol: the first message must be `{type:"auth", token}` within 5s,
 * otherwise the socket is closed. Authenticated clients may then send
 * `{type:"subscribe", projectId}` (membership is verified) and receive
 * `{type:"event", event}` messages.
 */
export async function startRealtime(
  db: Database,
  config: AppConfig,
): Promise<RealtimeHandles> {
  clients.clear();
  const wss = new WebSocketServer({ port: config.wsPort, host: config.httpHost });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });
  const port = (wss.address() as { port: number }).port;
  console.log(`[realtime] websocket listening on ${config.httpHost}:${port}`);

  wss.on("connection", (ws) => {
    const client: Client = { ws, authed: false, projects: new Set() };
    clients.add(client);
    const timer = setTimeout(() => {
      if (!client.authed) {
        try {
          ws.close(4408, "auth timeout");
        } catch {
          // ignore
        }
      }
    }, AUTH_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();

    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const m = msg as { type?: unknown; token?: unknown; projectId?: unknown };

      if (!client.authed) {
        if (m.type === "auth" && typeof m.token === "string") {
          const claims = verifyToken(m.token, config.jwtSecret);
          if (!claims) {
            ws.close(4401, "unauthorized");
            return;
          }
          client.authed = true;
          client.userId = claims.sub;
          clearTimeout(timer);
          ws.send(JSON.stringify({ type: "auth_ok" }));
        } else {
          ws.close(4401, "unauthorized");
        }
        return;
      }

      if (m.type === "subscribe" && typeof m.projectId === "string") {
        const project = db
          .prepare("SELECT org_id FROM projects WHERE id = ?")
          .get(m.projectId) as { org_id: string } | undefined;
        const role =
          project && client.userId
            ? getOrgRole(db, client.userId, project.org_id)
            : null;
        if (!project || !role) {
          ws.send(JSON.stringify({ type: "error", error: "forbidden" }));
          return;
        }
        client.projects.add(m.projectId);
        ws.send(JSON.stringify({ type: "subscribed", projectId: m.projectId }));
        return;
      }
      if (m.type === "unsubscribe" && typeof m.projectId === "string") {
        client.projects.delete(m.projectId);
        ws.send(JSON.stringify({ type: "unsubscribed", projectId: m.projectId }));
      }
    });

    ws.on("close", () => {
      clearTimeout(timer);
      clients.delete(client);
    });
    ws.on("error", () => {
      clearTimeout(timer);
      clients.delete(client);
    });
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of clients) {
          try {
            client.ws.close();
          } catch {
            // ignore
          }
        }
        clients.clear();
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
