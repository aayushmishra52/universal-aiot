#!/usr/bin/env node
/**
 * aiot-sdk — the Universal AIoT firmware SDK CLI.
 *
 * Scaffolds, validates, builds, tests, flashes and packages ESP32 firmware
 * projects that speak the canonical @aiot/contracts protocol (v1).
 */
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerCreate } from "../commands/create.js";
import { registerBuild } from "../commands/build.js";
import { registerTest } from "../commands/test.js";
import { registerSimulate } from "../commands/simulate.js";
import { registerDoctor } from "../commands/doctor.js";
import { registerDiagnose } from "../commands/diagnose.js";
import { registerRepair } from "../commands/repair.js";
import { registerClean } from "../commands/clean.js";
import { registerFlash } from "../commands/flash.js";
import { registerPackage } from "../commands/package.js";

function packageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();
program
  .name("aiot-sdk")
  .description("Universal AIoT firmware SDK: create, build, test, flash, package")
  .version(packageVersion());

registerCreate(program);
registerBuild(program);
registerTest(program);
registerSimulate(program);
registerDoctor(program);
registerDiagnose(program);
registerRepair(program);
registerClean(program);
registerFlash(program);
registerPackage(program);

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(`\nFatal: ${(e as Error).message}`);
  process.exit(1);
});
