/**
 * `aiot-sdk clean` — remove build artifacts, keep config and sources.
 */
import type { Command } from "commander";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "./util.js";

export function registerClean(program: Command): void {
  program
    .command("clean")
    .description("Remove build artifacts (keeps config/ and sources)")
    .option("--project-dir <dir>", "project directory", ".")
    .action((opts: { projectDir: string }) => {
      const dir = resolve(opts.projectDir);
      const buildDir = join(dir, "build");
      if (!existsSync(join(dir, "config", "aiot.config.json"))) {
        fail(`Not an aiot-sdk project: no config/aiot.config.json in ${dir}`);
      }
      if (existsSync(buildDir)) {
        rmSync(buildDir, { recursive: true, force: true });
        console.log(`Removed ${buildDir}/`);
      } else {
        console.log("Nothing to clean (no build/ directory).");
      }
      console.log("Kept: config/, sources, manifest, docs.");
    });
}
