/**
 * `aiot-sdk simulate` — run the virtual device for a project.
 *
 * Shells out to `npx aiot-virtual-device` (the @aiot/virtual-device package).
 * Guard: if that package is not built/installed, print a clear error instead
 * of faking a simulation.
 */
import type { Command } from "commander";
import { spawn } from "node:child_process";
import { loadProjectConfig, run, fail } from "./util.js";

export function registerSimulate(program: Command): void {
  program
    .command("simulate")
    .description("Simulate this project with the virtual device (requires @aiot/virtual-device)")
    .option("--project-dir <dir>", "project directory", ".")
    .option("--broker <url>", "MQTT broker URL")
    .option("--org <id>", "org id (default: from project config)")
    .option("--project <id>", "project id (default: from project config)")
    .option("--device <id>", "device id (default: from project config)")
    .option("--username <user>", "MQTT username", "")
    .option("--password <pass>", "MQTT password", "")
    .action(
      async (opts: {
        projectDir: string;
        broker?: string;
        org?: string;
        project?: string;
        device?: string;
        username: string;
        password: string;
      }) => {
        let cfg;
        try {
          cfg = loadProjectConfig(opts.projectDir);
        } catch (e) {
          fail((e as Error).message);
        }

        // Guard: the virtual device must really exist. --no-install makes npx
        // fail instead of fetching something unexpected from the network.
        const probe = await run("npx", ["--no-install", "aiot-virtual-device", "--version"]);
        if (probe.code !== 0) {
          fail(
            `@aiot/virtual-device is not available (npx aiot-virtual-device failed).\n` +
              `It is built in parallel at packages/virtual-device — build it first:\n` +
              `  npm run build --workspace=@aiot/virtual-device\n` +
              `Refusing to fake a simulation.`,
          );
        }

        const args = [
          "aiot-virtual-device",
          "--broker", opts.broker ?? `mqtt://${cfg.mqtt.host}:${cfg.mqtt.port}`,
          "--org", opts.org ?? cfg.orgId,
          "--project", opts.project ?? cfg.projectId,
          "--device", opts.device ?? cfg.deviceId,
        ];
        if (opts.username) args.push("--username", opts.username);
        if (opts.password) args.push("--password", opts.password);

        console.log(`Starting virtual device for ${cfg.deviceName} (${cfg.deviceId})…`);
        const child = spawn("npx", args, { stdio: "inherit" });
        child.on("error", (e) => fail(`failed to start virtual device: ${e.message}`));
        child.on("exit", (code) => process.exit(code ?? 1));
      },
    );
}
