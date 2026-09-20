import type { AedesBroker } from "./broker.js";
import { topicCommand, type Command } from "@aiot/contracts";

let broker: AedesBroker | null = null;

/** Called once at boot so services can publish without importing the broker. */
export function setBroker(instance: AedesBroker): void {
  broker = instance;
}

/** Publish a command payload to a device's command topic (QoS 1). */
export function publishCommand(
  orgId: string,
  projectId: string,
  deviceId: string,
  command: Command,
): Promise<void> {
  const active = broker;
  if (!active) return Promise.reject(new Error("mqtt broker is not started"));
  return new Promise<void>((resolve, reject) => {
    active.publish(
      {
        cmd: "publish",
        topic: topicCommand(orgId, projectId, deviceId),
        payload: Buffer.from(JSON.stringify(command)),
        qos: 1,
        dup: false,
        retain: false,
      },
      (err?: Error) => (err ? reject(err) : resolve()),
    );
  });
}
