import AedesDefault from "aedes";
import type { AedesOptions, createBroker as createBrokerDecl } from "aedes";
import net from "node:net";
import type { Database } from "better-sqlite3";
import { topicCommand, topicRoot } from "@aiot/contracts";
import { verifyPassword } from "../auth/password.js";
import type { AppConfig } from "../config.js";

/** Aedes broker instance type (via the createBroker factory signature). */
export type AedesBroker = ReturnType<typeof createBrokerDecl>;

// The aedes .d.ts re-exports its default in a way TypeScript under NodeNext
// resolves to the module namespace; at runtime the default IS the broker
// constructor (CJS `module.exports = Aedes`). Assert the real shape once here.
const Aedes = AedesDefault as unknown as new (
  opts?: AedesOptions,
) => AedesBroker;

export interface BrokerDevice {
  deviceId: string;
  orgId: string;
  projectId: string;
}

export interface BrokerHandles {
  aedes: AedesBroker;
  server: net.Server;
  port: number;
  close: () => Promise<void>;
}

interface AuthenticatedClient {
  device?: BrokerDevice;
}

function deviceOf(client: unknown): BrokerDevice | undefined {
  return (client as AuthenticatedClient | undefined)?.device;
}

/** Build an authentication error carrying a CONNACK return code (4 = bad credentials). */
function authError(message: string): Error & { returnCode: 4 } {
  const err = new Error(message) as Error & { returnCode: 4 };
  err.returnCode = 4;
  return err;
}

/**
 * Start the MQTT broker (aedes).
 *
 * Authentication accepts either a one-time pairing credential (unused,
 * unexpired, unrevoked) or an active device credential, both verified with
 * bcrypt. Auth failures are logged WITHOUT the password.
 */
export async function startBroker(
  db: Database,
  config: AppConfig,
): Promise<BrokerHandles> {
  const aedes: AedesBroker = new Aedes();

  aedes.authenticate = (client, username, password, callback) => {
    try {
      const uname = username ?? "";
      const secret = password?.toString() ?? "";
      if (!uname || !secret) {
        callback(authError("missing credentials"), false);
        return;
      }
      const now = Date.now();
      const pairing = db
        .prepare(
          `SELECT p.password_hash AS password_hash, p.device_id_fk AS device_id,
                  d.org_id AS org_id, d.project_id AS project_id
           FROM pairings p JOIN devices d ON d.device_id = p.device_id_fk
           WHERE p.username = ? AND p.used_at IS NULL
             AND p.revoked_at IS NULL AND p.expires_at > ?`,
        )
        .get(uname, now) as
        | { password_hash: string; device_id: string; org_id: string; project_id: string }
        | undefined;
      if (pairing && verifyPassword(secret, pairing.password_hash)) {
        (client as AuthenticatedClient).device = {
          deviceId: pairing.device_id,
          orgId: pairing.org_id,
          projectId: pairing.project_id,
        };
        callback(null, true);
        return;
      }
      const credential = db
        .prepare(
          `SELECT c.password_hash AS password_hash, c.device_id_fk AS device_id,
                  d.org_id AS org_id, d.project_id AS project_id
           FROM device_credentials c JOIN devices d ON d.device_id = c.device_id_fk
           WHERE c.username = ? AND c.revoked_at IS NULL`,
        )
        .get(uname) as
        | { password_hash: string; device_id: string; org_id: string; project_id: string }
        | undefined;
      if (credential && verifyPassword(secret, credential.password_hash)) {
        (client as AuthenticatedClient).device = {
          deviceId: credential.device_id,
          orgId: credential.org_id,
          projectId: credential.project_id,
        };
        callback(null, true);
        return;
      }
      // Log the attempt without the secret.
      console.warn(`[mqtt] authentication failed for username="${uname}"`);
      callback(authError("not authorized"), false);
    } catch (err) {
      console.error("[mqtt] authentication error:", (err as Error)?.message ?? err);
      callback(authError("authentication error"), false);
    }
  };

  // Devices may only publish under their own topic root.
  aedes.authorizePublish = (client, packet, callback) => {
    const device = deviceOf(client);
    if (!device || !packet?.topic) {
      callback(new Error("forbidden"));
      return;
    }
    const root = topicRoot(device.orgId, device.projectId, device.deviceId);
    if (packet.topic === root || packet.topic.startsWith(`${root}/`)) {
      callback(null);
      return;
    }
    callback(new Error("forbidden"));
  };

  // Devices may only subscribe to their own command topic.
  aedes.authorizeSubscribe = (client, subscription, callback) => {
    const device = deviceOf(client);
    if (
      device &&
      subscription?.topic === topicCommand(device.orgId, device.projectId, device.deviceId)
    ) {
      callback(null, subscription);
      return;
    }
    callback(new Error("forbidden"));
  };

  const server = net.createServer(aedes.handle);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.mqttPort, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const port = (server.address() as net.AddressInfo).port;
  console.log(`[mqtt] broker listening on 127.0.0.1:${port}`);

  return {
    aedes,
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        aedes.close(() => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }),
  };
}
