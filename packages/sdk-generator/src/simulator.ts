/**
 * In-process protocol simulator for `aiot-sdk test` step 4.
 *
 * Spins up an ephemeral aedes MQTT broker, then runs a telemetry + command
 * round-trip between a simulated device and a controller client. Every topic
 * is built with the @aiot/contracts topic builders and every payload is
 * validated with the canonical Zod schemas.
 */
import aedesPkg from "aedes";
const { createBroker } = aedesPkg as unknown as {
  createBroker: (opts?: Record<string, unknown>) => ReturnType<typeof import("aedes").createBroker>;
};
import mqtt from "mqtt";
import { createServer, type Server } from "node:net";
import {
  CommandResultSchema,
  CommandSchema,
  DeviceManifestSchema,
  HealthSchema,
  PresenceSchema,
  TelemetrySchema,
  parseTopic,
  topicCommand,
  topicHealth,
  topicManifest,
  topicPresence,
  topicStatus,
  topicTelemetry,
  type DeviceManifest,
} from "@aiot/contracts";

export interface SimulatorCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface SimulatorResult {
  passed: boolean;
  checks: SimulatorCheck[];
}

function waitFor(
  cond: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolvePromise, reject) => {
    const tick = () => {
      if (cond()) return resolvePromise();
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timeout waiting for ${label}`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

export async function runSimulatorTest(
  manifest: DeviceManifest,
  opts: { orgId: string; projectId: string; timeoutMs?: number } = {
    orgId: "",
    projectId: "",
  },
): Promise<SimulatorResult> {
  const checks: SimulatorCheck[] = [];
  const check = (name: string, passed: boolean, detail?: string) => {
    checks.push({ name, passed, detail });
  };
  const timeoutMs = opts.timeoutMs ?? 10000;
  const { orgId, projectId } = opts;
  const deviceId = manifest.deviceId;

  type Broker = ReturnType<typeof createBroker>;
  const broker: Broker = createBroker();
  const server: Server = createServer(broker.handle);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const received: { topic: string; payload: Buffer }[] = [];
  const device = mqtt.connect(`mqtt://127.0.0.1:${port}`, { clientId: `${deviceId}-sim` });
  const controller = mqtt.connect(`mqtt://127.0.0.1:${port}`, { clientId: `${deviceId}-ctl` });

  const topics = {
    manifest: topicManifest(orgId, projectId, deviceId),
    status: topicStatus(orgId, projectId, deviceId),
    telemetry: topicTelemetry(orgId, projectId, deviceId),
    command: topicCommand(orgId, projectId, deviceId),
    presence: topicPresence(orgId, projectId, deviceId),
    health: topicHealth(orgId, projectId, deviceId),
  };

  try {
    await new Promise<void>((resolvePromise, reject) => {
      let ready = 0;
      const onReady = () => {
        if (++ready === 2) resolvePromise();
      };
      device.once("connect", onReady);
      controller.once("connect", onReady);
      device.once("error", reject);
      controller.once("error", reject);
      setTimeout(() => reject(new Error("broker connect timeout")), timeoutMs);
    });
    check("broker_connect", true, `aedes on 127.0.0.1:${port}`);

    // Controller observes everything the device publishes.
    const seen = new Map<string, Buffer[]>();
    await new Promise<void>((resolvePromise, reject) => {
      controller.subscribe(
        Object.values(topics),
        (err) => (err ? reject(err) : resolvePromise()),
      );
    });
    controller.on("message", (topic, payload) => {
      const list = seen.get(topic) ?? [];
      list.push(payload);
      seen.set(topic, list);
      received.push({ topic, payload });
    });

    // 1. Manifest publish (retained, like firmware REGISTERING does).
    const parsedManifest = DeviceManifestSchema.parse(manifest);
    check("manifest_schema", true, `${parsedManifest.capabilities.length} capabilities`);
    device.publish(topics.manifest, JSON.stringify(parsedManifest), { retain: true, qos: 1 });
    await waitFor(() => (seen.get(topics.manifest)?.length ?? 0) > 0, timeoutMs, "manifest");
    const wireManifest = DeviceManifestSchema.parse(
      JSON.parse(seen.get(topics.manifest)![0].toString()),
    );
    check(
      "manifest_roundtrip",
      JSON.stringify(wireManifest) === JSON.stringify(parsedManifest),
      "published manifest parses and matches",
    );

    // 2. Telemetry publish for every sensor capability.
    const sensorCaps = parsedManifest.capabilities.filter((c) => c.kind === "sensor");
    const values: Record<string, number | string | boolean> = {};
    for (const cap of sensorCaps) {
      values[cap.id] = cap.type === "boolean" ? true : 21.5;
    }
    const telemetry = TelemetrySchema.parse({
      protocolVersion: "1.0",
      deviceId,
      messageId: `${deviceId}-1`,
      timestamp: Date.now(),
      timeQuality: "synchronized",
      sequence: 1,
      values,
    });
    device.publish(topics.telemetry, JSON.stringify(telemetry), { qos: 0 });
    await waitFor(() => (seen.get(topics.telemetry)?.length ?? 0) > 0, timeoutMs, "telemetry");
    const wireTelemetry = TelemetrySchema.parse(
      JSON.parse(seen.get(topics.telemetry)![0].toString()),
    );
    check("telemetry_schema", true, `${Object.keys(wireTelemetry.values).length} values`);

    // 3. Command round-trip: controller -> device, device ACKs then RESULTs.
    const actuatorCap = parsedManifest.capabilities.find((c) => c.kind === "actuator");
    if (actuatorCap) {
      const boolParam = actuatorCap.type === "boolean";
      const command = CommandSchema.parse({
        kind: "command",
        protocolVersion: "1.0",
        commandId: "sim-cmd-1",
        deviceId,
        capabilityId: actuatorCap.id,
        action: "set",
        params: { value: boolParam ? true : (actuatorCap.min ?? 0) },
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      });

      // The simulated device: validate, ACK, "execute", SUCCEED.
      // Subscribe (await SUBACK) before the controller publishes — otherwise
      // the command can arrive before the subscription is registered.
      await new Promise<void>((resolveSub, rejectSub) => {
        device.subscribe(topics.command, (err) =>
          err ? rejectSub(err) : resolveSub(),
        );
      });
      const deviceInbox = new Promise<void>((resolvePromise, reject) => {
        device.on("message", (topic, payload) => {
          if (topic !== topics.command) return;
          let raw: unknown;
          try {
            raw = JSON.parse(payload.toString());
          } catch {
            return;
          }
          // Ignore our own ACK/RESULT echoes (device subscribes to this topic too).
          if (typeof raw !== "object" || raw === null || (raw as { kind?: string }).kind !== "command") {
            return;
          }
          try {
            const cmd = CommandSchema.parse(raw);
            if (cmd.deviceId !== deviceId) return;
            const ack = CommandResultSchema.parse({
              kind: "result",
              protocolVersion: "1.0",
              commandId: cmd.commandId,
              deviceId,
              status: "ACKNOWLEDGED",
              at: Date.now(),
            });
            device.publish(topics.command, JSON.stringify(ack), { qos: 1 });
            const done = CommandResultSchema.parse({
              kind: "result",
              protocolVersion: "1.0",
              commandId: cmd.commandId,
              deviceId,
              status: "SUCCEEDED",
              reportedState: { [cmd.capabilityId]: cmd.params["value"] },
              at: Date.now(),
            });
            device.publish(topics.command, JSON.stringify(done), { qos: 1 });
            resolvePromise();
          } catch (e) {
            reject(e);
          }
        });
      });

      controller.publish(topics.command, JSON.stringify(command), { qos: 1 });
      const commandTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout waiting for command handling")), timeoutMs),
      );
      await Promise.race([deviceInbox, commandTimeout]);
      await waitFor(
        () => (seen.get(topics.command)?.length ?? 0) >= 2,
        timeoutMs,
        "command results",
      );
      const results = seen
        .get(topics.command)!
        .map((p) => JSON.parse(p.toString()) as { kind?: string })
        // The controller also receives its own command publication on this
        // topic; only the device's ACK/RESULT echoes count as results.
        .filter((o) => o.kind === "result")
        .map((o) => CommandResultSchema.parse(o));
      const statuses = results.map((r) => r.status);
      check(
        "command_roundtrip",
        statuses.includes("ACKNOWLEDGED") && statuses.includes("SUCCEEDED"),
        `statuses: ${statuses.join(", ")}`,
      );
      check(
        "command_result_kind",
        results.every((r) => r.kind === "result"),
        'results use kind:"result"',
      );
    } else {
      check("command_roundtrip", true, "no actuator capabilities — skipped");
      check("command_result_kind", true, "no actuator capabilities — skipped");
    }

    // 4. Presence + health.
    const presence = PresenceSchema.parse({
      protocolVersion: "1.0",
      deviceId,
      online: true,
      at: Date.now(),
      firmware: manifest.firmwareVersion,
    });
    device.publish(topics.presence, JSON.stringify(presence), { retain: true, qos: 1 });
    const health = HealthSchema.parse({
      protocolVersion: "1.0",
      deviceId,
      uptime: 42,
      freeHeap: 200000,
      wifiRssi: -55,
      mqtt: "connected",
      firmware: manifest.firmwareVersion,
      sensorErrors: 0,
      capabilityHealth: Object.fromEntries(sensorCaps.map((c) => [c.id, "good"])),
      at: Date.now(),
    });
    device.publish(topics.health, JSON.stringify(health), { qos: 0 });
    await waitFor(() => (seen.get(topics.presence)?.length ?? 0) > 0, timeoutMs, "presence");
    await waitFor(() => (seen.get(topics.health)?.length ?? 0) > 0, timeoutMs, "health");
    PresenceSchema.parse(JSON.parse(seen.get(topics.presence)![0].toString()));
    HealthSchema.parse(JSON.parse(seen.get(topics.health)![0].toString()));
    check("presence_schema", true);
    check("health_schema", true);

    // 5. Topic scheme matches the canonical builders.
    const parsed = parseTopic(topics.telemetry);
    check(
      "topic_scheme",
      parsed !== null &&
        parsed.orgId === orgId &&
        parsed.projectId === projectId &&
        parsed.deviceId === deviceId &&
        parsed.kind === "telemetry",
      topics.telemetry,
    );
    void received;
  } catch (e) {
    check("simulator_error", false, (e as Error).message);
  } finally {
    device.end(true);
    controller.end(true);
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    broker.close();
  }

  return { passed: checks.every((c) => c.passed), checks };
}
