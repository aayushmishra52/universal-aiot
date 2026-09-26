/**
 * Shared helpers for aiot-sdk commands.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getBoard } from "../board-registry/index.js";
import { defaultSketchbookDir } from "../arduino-dirs.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command, capturing output. Never throws on non-zero exit. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 600000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        resolvePromise({
          code: error && typeof (error as { code?: number }).code === "number"
            ? ((error as { code?: number }).code as number)
            : error
              ? 1
              : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

/** True when a binary is on PATH. */
export async function commandExists(cmd: string): Promise<boolean> {
  const r = await run(process.platform === "win32" ? "where" : "sh", [
    process.platform === "win32" ? cmd : "-c",
    process.platform === "win32" ? "" : `command -v ${cmd}`,
  ]);
  return r.code === 0 && r.stdout.trim().length > 0;
}

/**
 * Resolve the sketchbook libraries dir, honouring the user's arduino-cli
 * configuration (`directories.user`). Falls back to the conventional
 * location when arduino-cli is missing or misconfigured.
 *
 * The generated sketch.yaml points at the pinned libraries with
 * `- dir: <this>/libraries/<name>`, and `aiot-sdk repair` installs them
 * here, so both sides stay in agreement.
 */
export async function resolveLibraryDir(): Promise<string> {
  if (await commandExists("arduino-cli")) {
    const r = await run("arduino-cli", ["config", "get", "directories.user"]);
    const user = r.code === 0 ? r.stdout.trim() : "";
    if (user) return join(user, "libraries");
  }
  return join(defaultSketchbookDir(), "libraries");
}

export interface ProjectConfig {
  version: number;
  generator: string;
  deviceName: string;
  deviceId: string;
  projectId: string;
  orgId: string;
  board: string;
  firmwareVersion: string;
  mqtt: { host: string; port: number; tls: boolean };
  sensors: { sensor: string; pin: number }[];
  actuators: { actuator: string; pin: number }[];
}

/** Load and minimally validate config/aiot.config.json from a project dir. */
export function loadProjectConfig(projectDir: string): ProjectConfig {
  const dir = resolve(projectDir);
  const path = join(dir, "config", "aiot.config.json");
  if (!existsSync(path)) {
    throw new Error(
      `Not an aiot-sdk project: ${path} not found.\n` +
        `Run this inside a directory created by "aiot-sdk create".`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
  const cfg = parsed as Partial<ProjectConfig>;
  const missing: string[] = [];
  for (const key of ["deviceId", "projectId", "orgId", "board"] as const) {
    if (!cfg[key]) missing.push(key);
  }
  if (!cfg.mqtt?.host) missing.push("mqtt.host");
  if (missing.length > 0) {
    throw new Error(`Invalid ${path}: missing ${missing.join(", ")}.`);
  }
  return cfg as ProjectConfig;
}

/** FQBN for the board recorded in the project config. */
export function projectFqbn(cfg: ProjectConfig): string {
  const board = getBoard(cfg.board);
  if (!board) throw new Error(`Unknown board "${cfg.board}" in project config.`);
  return board.fqbn;
}

/** Print a section header for CLI output. */
export function header(title: string): void {
  console.log(`\n=== ${title} ===`);
}

export function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}
