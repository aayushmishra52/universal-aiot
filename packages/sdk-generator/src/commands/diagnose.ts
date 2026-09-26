/**
 * `aiot-sdk diagnose` — collect environment info for bug reports.
 * Passwords, tokens and other secrets are redacted before printing.
 */
import type { Command } from "commander";
import { platform, release, arch } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { commandExists, run } from "./util.js";
import { GENERATOR_VERSION } from "../generate/render.js";

export function redactSecrets(text: string): string {
  return (
    text
      // JSON-ish: "mqttPass": "secret"
      .replace(
        /("(?:password|passwd|pwd|secret|token|api[_-]?key|mqttPass|mqtt_pass|wifiPass|wifi_pass)"\s*:\s*)"[^"]*"/gi,
        '$1"[REDACTED]"',
      )
      // KEY=secret / key: secret lines
      .replace(
        /^(\s*(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*).+$/gim,
        "$1[REDACTED]",
      )
      // C defines: #define MQTT_PASS "secret"
      .replace(
        /(#define\s+(?:MQTT_PASS|WIFI_PASS|MQTT_USER|API_KEY|TOKEN)\s+)"[^"]*"/g,
        '$1"[REDACTED]"',
      )
  );
}

export async function collectDiagnostics(projectDir?: string): Promise<Record<string, unknown>> {
  const diag: Record<string, unknown> = {
    collectedAt: new Date().toISOString(),
    sdkGenerator: GENERATOR_VERSION,
    os: `${platform()} ${release()} (${arch()})`,
    node: process.versions.node,
  };

  if (await commandExists("arduino-cli")) {
    const v = await run("arduino-cli", ["version"]);
    diag.arduinoCli = v.stdout.trim().split("\n")[0];
    const cores = await run("arduino-cli", ["core", "list", "--format", "json"]);
    try {
      const list = JSON.parse(cores.stdout) as { ID?: string; Installed?: string }[];
      diag.cores = (Array.isArray(list) ? list : []).map((c) => `${c.ID}@${c.Installed ?? "?"}`);
    } catch {
      diag.cores = "unparseable";
    }
    const libs = await run("arduino-cli", ["lib", "list", "--format", "json"]);
    try {
      const list = JSON.parse(libs.stdout) as { library?: { name?: string; version?: string } }[];
      diag.libraries = (Array.isArray(list) ? list : [])
        .map((l) => `${l.library?.name}@${l.library?.version}`)
        .filter((s) => /ArduinoJson|espMqttClient|DHT|Adafruit/i.test(s));
    } catch {
      diag.libraries = "unparseable";
    }
  } else {
    diag.arduinoCli = "not installed";
  }

  if (projectDir) {
    const cfgPath = join(resolve(projectDir), "config", "aiot.config.json");
    if (existsSync(cfgPath)) {
      diag.projectConfig = JSON.parse(readFileSync(cfgPath, "utf8"));
    } else {
      diag.projectConfig = "not found";
    }
  }
  return diag;
}

export function registerDiagnose(program: Command): void {
  program
    .command("diagnose")
    .description("Collect environment diagnostics (secrets redacted)")
    .option("--project-dir <dir>", "include project config from this directory")
    .action(async (opts: { projectDir?: string }) => {
      const diag = await collectDiagnostics(opts.projectDir);
      console.log(redactSecrets(JSON.stringify(diag, null, 2)));
    });
}
