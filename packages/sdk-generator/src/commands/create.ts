/**
 * `aiot-sdk create` — scaffold a new firmware project.
 *
 * Flag mode:  --board esp32 --device-id DEV-XXXXX ... --sensor dht22
 *              --sensor-pin 4 --actuator led --actuator-pin 2 ...
 * Interactive: no selection flags -> guided prompts.
 *
 * Everything is validated BEFORE anything is written.
 */
import type { Command } from "commander";
import { input, select, confirm } from "@inquirer/prompts";
import { basename, resolve } from "node:path";
import { writeProject, deviceSlugFor } from "../generate/render.js";
import {
  generateDeviceId,
  validateGenerateInput,
  type GenerateInput,
} from "../generate/input.js";
import {
  boardIds,
  getBoard,
  listBoards,
} from "../board-registry/index.js";
import { sensorIds, getSensor, listSensors } from "../sensor-registry/index.js";
import {
  actuatorIds,
  getActuator,
  listActuators,
} from "../actuator-registry/index.js";
import { fail, resolveLibraryDir } from "./util.js";

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function collectInt(value: string, previous: number[]): number[] {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`Expected an integer pin, got "${value}"`);
  return previous.concat([n]);
}

interface RawOptions {
  board: string;
  deviceId?: string;
  deviceName?: string;
  projectId?: string;
  orgId?: string;
  sensor: string[];
  sensorPin: number[];
  actuator: string[];
  actuatorPin: number[];
  mqttHost: string;
  mqttPort: string;
  mqttUser: string;
  mqttPass: string;
  wifiSsid: string;
  wifiPass: string;
  tls: boolean;
  out?: string;
}

async function promptInteractive(): Promise<Partial<RawOptions>> {
  const board = await select({
    message: "Board",
    choices: listBoards().map((b) => ({
      name: `${b.name} (${b.fqbn})`,
      value: b.id,
    })),
  });
  const deviceName = await input({
    message: "Device name",
    default: "Golden Room",
  });
  const deviceId = await input({
    message: "Device ID",
    default: generateDeviceId(),
    validate: (v) =>
      /^DEV-[A-Z0-9]{5,12}$/.test(v) || "Must match DEV-[A-Z0-9]{5,12}",
  });
  const orgId = await input({ message: "Org ID", default: "org-1" });
  const projectId = await input({ message: "Project ID", default: "project-1" });

  const sensors: string[] = [];
  const sensorPin: number[] = [];
  const actuators: string[] = [];
  const actuatorPin: number[] = [];

  let addSensor = await confirm({ message: "Add a sensor?", default: true });
  while (addSensor) {
    const s = await select({
      message: "Sensor",
      choices: listSensors().map((x) => ({
        name: `${x.name} (${x.id})`,
        value: x.id,
      })),
    });
    const pin = await input({
      message: `GPIO pin for ${s}`,
      validate: (v) => Number.isInteger(Number(v)) || "Enter an integer GPIO number",
    });
    sensors.push(s);
    sensorPin.push(Number(pin));
    addSensor = await confirm({ message: "Add another sensor?", default: false });
  }

  let addActuator = await confirm({ message: "Add an actuator?", default: true });
  while (addActuator) {
    const a = await select({
      message: "Actuator",
      choices: listActuators().map((x) => ({
        name: `${x.name} (${x.id})`,
        value: x.id,
      })),
    });
    const pin = await input({
      message: `GPIO pin for ${a}`,
      validate: (v) => Number.isInteger(Number(v)) || "Enter an integer GPIO number",
    });
    actuators.push(a);
    actuatorPin.push(Number(pin));
    addActuator = await confirm({ message: "Add another actuator?", default: false });
  }

  const mqttHost = await input({ message: "MQTT host", default: "localhost" });
  const mqttPort = await input({ message: "MQTT port", default: "1883" });
  const wifiSsid = await input({ message: "WiFi SSID (stored in gitignored config.h)", default: "" });
  const wifiPass = await input({ message: "WiFi password (stored in gitignored config.h)", default: "" });

  return {
    board, deviceName, deviceId, orgId, projectId,
    sensor: sensors, sensorPin, actuator: actuators, actuatorPin,
    mqttHost, mqttPort, wifiSsid, wifiPass,
  };
}

function toGenerateInput(opts: RawOptions, libraryDir: string): GenerateInput {
  const sensors = opts.sensor ?? [];
  const sensorPin = opts.sensorPin ?? [];
  const actuators = opts.actuator ?? [];
  const actuatorPin = opts.actuatorPin ?? [];
  if (sensors.length !== sensorPin.length) {
    fail(
      `--sensor (${sensors.length}) and --sensor-pin (${sensorPin.length}) counts differ. ` +
        `Pass them in pairs, e.g. --sensor dht22 --sensor-pin 4 --sensor light --sensor-pin 34.`,
    );
  }
  if (actuators.length !== actuatorPin.length) {
    fail(
      `--actuator (${actuators.length}) and --actuator-pin (${actuatorPin.length}) counts differ. ` +
        `Pass them in pairs, e.g. --actuator led --actuator-pin 2.`,
    );
  }
  const deviceName = opts.deviceName ?? "AIoT Device";
  const deviceId = opts.deviceId ?? generateDeviceId();
  return {
    boardId: opts.board,
    deviceId,
    projectId: opts.projectId ?? "project-1",
    orgId: opts.orgId ?? "org-1",
    deviceName,
    firmwareVersion: "1.0.0",
    sensors: sensors.map((sensorId, i) => ({ sensorId, pin: sensorPin[i] })),
    actuators: actuators.map((actuatorId, i) => ({ actuatorId, pin: actuatorPin[i] })),
    mqttHost: opts.mqttHost,
    mqttPort: Number(opts.mqttPort),
    mqttUser: opts.mqttUser ?? "",
    mqttPass: opts.mqttPass ?? "",
    wifiSsid: opts.wifiSsid ?? "",
    wifiPass: opts.wifiPass ?? "",
    tls: opts.tls,
    outDir: opts.out ?? `./${deviceSlugFor(deviceName, deviceId)}`,
    libraryDir,
  };
}

export function registerCreate(program: Command): void {
  program
    .command("create")
    .description("Scaffold a new AIoT firmware project (validates everything before writing)")
    .option("--board <id>", `board id (${boardIds().join(", ")})`, "esp32")
    .option("--device-id <id>", "device id, e.g. DEV-9K2QX7 (generated if omitted)")
    .option("--device-name <name>", "human-friendly device name")
    .option("--project-id <id>", "project id")
    .option("--org-id <id>", "organisation id")
    .option("--sensor <id>", `sensor id (${sensorIds().join(", ")}) — repeatable`, collect, [])
    .option("--sensor-pin <pin>", "GPIO pin for the preceding --sensor — repeatable", collectInt, [])
    .option("--actuator <id>", `actuator id (${actuatorIds().join(", ")}) — repeatable`, collect, [])
    .option("--actuator-pin <pin>", "GPIO pin for the preceding --actuator — repeatable", collectInt, [])
    .option("--mqtt-host <host>", "MQTT broker host", "localhost")
    .option("--mqtt-port <port>", "MQTT broker port", "1883")
    .option("--mqtt-user <user>", "MQTT username (goes to gitignored config.h)", "")
    .option("--mqtt-pass <pass>", "MQTT password (goes to gitignored config.h)", "")
    .option("--wifi-ssid <ssid>", "WiFi SSID (goes to gitignored config.h)", "")
    .option("--wifi-pass <pass>", "WiFi password (goes to gitignored config.h)", "")
    .option("--tls", "use MQTT over TLS", false)
    .option("--out <dir>", "output directory (default: ./<device-name>)")
    .action(async (opts: RawOptions) => {
      const interactive =
        process.stdin.isTTY &&
        (opts.sensor ?? []).length === 0 &&
        (opts.actuator ?? []).length === 0 &&
        !opts.deviceId &&
        !opts.deviceName;
      const merged: RawOptions = interactive
        ? { ...opts, ...(await promptInteractive()) }
        : opts;

      const input = toGenerateInput(merged, await resolveLibraryDir());
      const { errors, warnings } = validateGenerateInput(input);
      if (errors.length > 0) {
        console.error("\nCannot generate — please fix:");
        for (const e of errors) console.error(`  ✗ ${e}`);
        process.exit(1);
      }
      for (const w of warnings) console.warn(`  ⚠ ${w}`);

      const board = getBoard(input.boardId);
      const { outDir, files } = writeProject(input);

      // arduino-cli requires the sketch directory name to match the .ino.
      // The default --out already does this; warn when an explicit --out
      // breaks it so the user finds out now instead of at build time.
      const slug = deviceSlugFor(input.deviceName, input.deviceId);
      if (basename(resolve(outDir)) !== slug) {
        console.warn(
          `\n  ⚠ Output directory "${outDir}" does not match the sketch name ` +
            `"${slug}.ino". arduino-cli requires them to match — rename the ` +
            `directory to "${slug}" before running aiot-sdk build/test/flash.`,
        );
      }

      console.log(`\nCreated ${files.length} files in ${outDir}/`);
      console.log(`  board:   ${board?.name} (${board?.fqbn})`);
      console.log(`  device:  ${input.deviceName} (${input.deviceId})`);
      for (const s of input.sensors) {
        const meta = getSensor(s.sensorId);
        console.log(`  sensor:  ${meta?.name} on GPIO ${s.pin}`);
      }
      for (const a of input.actuators) {
        const meta = getActuator(a.actuatorId);
        console.log(`  actuator:${meta?.name} on GPIO ${a.pin}`);
      }
      console.log(`\nNext steps:`);
      console.log(`  cd ${outDir}`);
      console.log(`  cp config/config.example.h config/config.h   # then fill in WiFi/MQTT secrets`);
      console.log(`  aiot-sdk test        # validate + compile + protocol + simulator tests`);
      console.log(`  aiot-sdk flash --port /dev/ttyUSB0`);
    });
}
