#!/usr/bin/env node
/**
 * aiot-virtual-device — run a virtual device speaking the canonical
 * Universal AIoT protocol against any MQTT broker.
 */
import { Command } from "commander";
import { VirtualDevice } from "./device.js";
import { goldenRoomPreset, type DevicePreset } from "./presets.js";

const PRESETS: Record<string, () => DevicePreset> = {
  "golden-room": goldenRoomPreset,
};

const program = new Command();
program
  .name("aiot-virtual-device")
  .description(
    "Virtual device speaking the canonical Universal AIoT protocol (MQTT)",
  )
  .requiredOption("--broker <url>", "MQTT broker URL, e.g. mqtt://localhost:1883")
  .requiredOption("--org <id>", "organization id")
  .requiredOption("--project <id>", "project id")
  .requiredOption("--device <id>", "device id, e.g. DEV-00001")
  .requiredOption("--username <u>", "MQTT username")
  .requiredOption("--password <p>", "MQTT password")
  .option("--preset <name>", "device preset", "golden-room")
  .option("--tick <ms>", "virtual tick interval in ms", "1000");

program.parse();
const opts = program.opts<{
  broker: string;
  org: string;
  project: string;
  device: string;
  username: string;
  password: string;
  preset: string;
  tick: string;
}>();

async function main(): Promise<void> {
  const presetFn = PRESETS[opts.preset];
  if (!presetFn) {
    console.error(
      `[VD] unknown preset "${opts.preset}" (available: ${Object.keys(PRESETS).join(", ")})`,
    );
    process.exit(1);
  }

  const device = new VirtualDevice({
    brokerUrl: opts.broker,
    orgId: opts.org,
    projectId: opts.project,
    deviceId: opts.device,
    username: opts.username,
    password: opts.password,
    preset: presetFn(),
    tickMs: Number(opts.tick) > 0 ? Number(opts.tick) : 1000,
  });

  device.on("connected", () => console.log(`[VD] ${opts.device} connected`));
  device.on("disconnected", () =>
    console.log(`[VD] ${opts.device} disconnected`),
  );
  device.on("telemetry", (t: { values: Record<string, unknown> }) => {
    const parts = Object.entries(t.values)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`[VD] telemetry ${parts}`);
  });
  device.on(
    "command",
    (c: { capabilityId: string; action: string; status: string }) => {
      console.log(`[VD] command ${c.capabilityId}=${c.action} -> ${c.status}`);
    },
  );
  device.on("error", (err: unknown) => {
    console.error(`[VD] error: ${err instanceof Error ? err.message : err}`);
  });

  const shutdown = () => {
    console.log(`[VD] ${opts.device} shutting down`);
    void device
      .disconnect()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await device.connect();
  } catch (err) {
    console.error(
      `[VD] failed to connect: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

void main();
