/**
 * `aiot-sdk flash` — upload firmware to the device.
 */
import type { Command } from "commander";
import { loadProjectConfig, projectFqbn, run, fail, header } from "./util.js";

export function registerFlash(program: Command): void {
  program
    .command("flash")
    .description("Upload the firmware to a connected device")
    .option("--project-dir <dir>", "project directory", ".")
    .option("--port <port>", "serial port (auto-detected when exactly one device is connected)")
    .action(async (opts: { projectDir: string; port?: string }) => {
      header("flash");
      let cfg;
      try {
        cfg = loadProjectConfig(opts.projectDir);
      } catch (e) {
        fail((e as Error).message);
      }

      let port = opts.port;
      if (!port) {
        const list = await run("arduino-cli", ["board", "list", "--format", "json"]);
        try {
          const boards = JSON.parse(list.stdout) as {
            port?: { address?: string; label?: string };
            boards?: { FQBN?: string }[];
          }[];
          const candidates = (Array.isArray(boards) ? boards : []).filter(
            (b) => b.port?.address && b.boards && b.boards.length > 0,
          );
          if (candidates.length === 1) {
            port = candidates[0].port!.address!;
            console.log(`Auto-detected port: ${port}`);
          } else if (candidates.length === 0) {
            fail("No device detected. Connect the board and retry, or pass --port explicitly.");
          } else {
            fail(
              `Multiple devices detected (${candidates.map((c) => c.port!.address).join(", ")}). Pass --port explicitly.`,
            );
          }
        } catch {
          fail("Could not list serial ports. Is arduino-cli installed?");
        }
      }

      const fqbn = projectFqbn(cfg);
      console.log(`Uploading ${cfg.deviceName} (${fqbn}) to ${port}…`);
      const r = await run("arduino-cli", [
        "upload", "-p", port!, "--fqbn", fqbn, opts.projectDir,
      ]);
      if (r.code !== 0) {
        console.error("\nUpload failed.");
        console.error("\n--- Technical details (raw output) ---");
        console.error(`${r.stdout}\n${r.stderr}`.trim() || "(no output)");
        process.exit(1);
      }
      console.log("Upload complete. Open a serial monitor at 115200 baud.");
    });
}
