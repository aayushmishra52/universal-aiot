/**
 * Test helpers: in-process aedes broker + message collection + waitFor.
 */
import Aedes from "aedes";
import { createServer, type Server } from "node:net";
import mqtt, { type MqttClient } from "mqtt";

export interface TestBroker {
  url: string;
  close(): Promise<void>;
}

export async function startBroker(): Promise<TestBroker> {
  const broker = Aedes();
  const server: Server = createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `mqtt://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        broker.close(() => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }),
  };
}

export interface CollectedMessage {
  topic: string;
  payload: Buffer;
}

/** Connect an observer client subscribed to `topics`, collecting messages. */
export async function subscribeObserver(
  url: string,
  topics: string[],
): Promise<{ client: MqttClient; messages: CollectedMessage[] }> {
  const client = mqtt.connect(url, { protocolVersion: 4 });
  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("error", reject);
  });
  const messages: CollectedMessage[] = [];
  client.on("message", (topic, payload) =>
    messages.push({ topic, payload: payload as Buffer }),
  );
  await new Promise<void>((resolve, reject) => {
    client.subscribe(topics, { qos: 1 }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
  return { client, messages };
}

export function parseJson(buf: Buffer): unknown {
  return JSON.parse(buf.toString("utf8"));
}

/** Poll `cond` until true or timeout. */
export async function waitFor(
  cond: () => boolean,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out waiting for condition");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function endClient(client: MqttClient): Promise<void> {
  await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
}
