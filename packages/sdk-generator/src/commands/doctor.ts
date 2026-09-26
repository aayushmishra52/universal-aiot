/**
 * `aiot-sdk doctor` — check the local toolchain and environment.
 */
import type { Command } from "commander";
import { commandExists, run, header } from "./util.js";
import { PINNED_VERSIONS } from "../versions.js";

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export async function runDoctorChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    status: nodeMajor >= 22 ? "ok" : "fail",
    detail: `v${process.versions.node} (need >= 22)`,
  });

  if (await commandExists("arduino-cli")) {
    const v = await run("arduino-cli", ["version"]);
    const m = v.stdout.match(/Version:\s*(\S+)/);
    checks.push({ name: "arduino-cli", status: "ok", detail: m ? m[1] : v.stdout.trim().split("\n")[0] });

    const cores = await run("arduino-cli", ["core", "list", "--format", "json"]);
    let esp32 = "not installed";
    let espStatus: Check["status"] = "warn";
    try {
      const parsed = JSON.parse(cores.stdout) as {
        platforms?: { id?: string; installed_version?: string }[];
      };
      const platforms = Array.isArray(parsed.platforms) ? parsed.platforms : [];
      const found = platforms.find((c) => c.id === "esp32:esp32");
      if (found) {
        esp32 = `installed (${found.installed_version ?? "unknown version"})`;
        espStatus = found.installed_version === PINNED_VERSIONS.esp32Core ? "ok" : "warn";
        if (espStatus === "warn") esp32 += ` — want ${PINNED_VERSIONS.esp32Core}: aiot-sdk repair`;
      }
    } catch {
      /* leave as warn */
    }
    checks.push({ name: "esp32 core", status: espStatus, detail: esp32 });
  } else {
    checks.push({ name: "arduino-cli", status: "fail", detail: "not on PATH — run: aiot-sdk repair" });
    checks.push({ name: "esp32 core", status: "warn", detail: "unknown (arduino-cli missing)" });
  }

  checks.push({
    name: "git",
    status: (await commandExists("git")) ? "ok" : "warn",
    detail: (await commandExists("git")) ? (await run("git", ["--version"])).stdout.trim() : "not on PATH",
  });

  // Pinned libraries (see PINNED_VERSIONS.md). espMqttClient is not in the
  // Library Manager index, so it is checked by directory presence.
  if (await commandExists("arduino-cli")) {
    const pinned: [string, string][] = [
      ["ArduinoJson", PINNED_VERSIONS.arduinoJson],
      ["DHT sensor library", PINNED_VERSIONS.dhtSensor],
      ["Adafruit Unified Sensor", PINNED_VERSIONS.adafruitUnified],
      ["AsyncTCP", PINNED_VERSIONS.asyncTcp],
    ];
    let installed: { library?: { name?: string; version?: string } }[] = [];
    try {
      const libs = await run("arduino-cli", ["lib", "list", "--format", "json"]);
      const parsed = JSON.parse(libs.stdout) as {
        installed_libraries?: { library?: { name?: string; version?: string } }[];
      };
      installed = Array.isArray(parsed.installed_libraries) ? parsed.installed_libraries : [];
    } catch {
      /* leave empty -> all warn */
    }
    for (const [libName, want] of pinned) {
      const found = installed.find((l) => l.library?.name === libName);
      const have = found?.library?.version;
      if (have === want) {
        checks.push({ name: `lib ${libName}`, status: "ok", detail: `${have} (pinned)` });
      } else if (have) {
        checks.push({
          name: `lib ${libName}`,
          status: "warn",
          detail: `${have} installed, want ${want} — run: aiot-sdk repair`,
        });
      } else {
        checks.push({ name: `lib ${libName}`, status: "warn", detail: `missing — run: aiot-sdk repair` });
      }
    }
  }

  // Serial ports / hardware
  let hardwareDetail = "not checked";
  let hardwareStatus: Check["status"] = "warn";
  if (await commandExists("arduino-cli")) {
    const boards = await run("arduino-cli", ["board", "list", "--format", "json"]);
    try {
      const list = JSON.parse(boards.stdout) as { port?: { address?: string }; boards?: unknown[] }[];
      const connected = (Array.isArray(list) ? list : []).filter(
        (b) => b.port?.address && b.boards && (b.boards as unknown[]).length > 0,
      );
      if (connected.length > 0) {
        hardwareDetail = connected.map((b) => b.port!.address!).join(", ");
        hardwareStatus = "ok";
      } else {
        hardwareDetail = "none detected";
        hardwareStatus = "warn";
      }
    } catch {
      /* leave as warn */
    }
  }
  checks.push({ name: "hardware", status: hardwareStatus, detail: hardwareDetail });

  return checks;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check the local toolchain (node, arduino-cli, esp32 core, git, hardware)")
    .action(async () => {
      header("doctor");
      const checks = await runDoctorChecks();
      let failed = false;
      for (const c of checks) {
        const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
        console.log(`  ${icon} ${c.name}: ${c.detail}`);
        if (c.status === "fail") failed = true;
      }
      const hw = checks.find((c) => c.name === "hardware");
      if (hw && hw.status !== "ok") {
        console.log("\nHardware: NOT CONNECTED — OK, virtual development does not require hardware.");
      }
      if (failed) process.exit(1);
    });
}
