/**
 * `aiot-sdk build` — compile firmware with arduino-cli.
 * Shared by `test` (compile step). Error output is translated into friendly
 * hints; the raw log is always shown under "Technical details".
 */
import type { Command } from "commander";
import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadProjectConfig, projectFqbn, run, fail, header, commandExists } from "./util.js";

export interface CompileResult {
  ok: boolean;
  hints: string[];
  stdout: string;
  stderr: string;
}

/** Map common arduino-cli failures to actionable hints. */
export function parseCompileErrors(output: string): string[] {
  const hints: string[] = [];
  const missingLib = output.match(/No such file or directory:\s*(\S+\.h)/);
  if (missingLib) {
    hints.push(
      `Missing library providing "${missingLib[1]}". Install pinned libraries with: aiot-sdk repair`,
    );
  }
  if (/was not declared in this scope/.test(output)) {
    hints.push(
      `A name was not declared in this scope — usually a missing #include or a typo in generated code. ` +
        `If you edited the firmware by hand, double-check includes; otherwise report the template bug.`,
    );
  }
  if (/platform not installed|Error resolving FQBN|no platform installed/i.test(output)) {
    hints.push(
      `The ESP32 core is not installed for this FQBN. Install it with: aiot-sdk repair`,
    );
  }
  if (/library not found|No such file or directory/i.test(output) && !missingLib) {
    hints.push(`A file or library is missing. Try: aiot-sdk repair`);
  }
  return [...new Set(hints)];
}

export async function compileProject(
  projectDir: string,
  opts: { verbose?: boolean } = {},
): Promise<CompileResult> {
  const dir = resolve(projectDir);
  if (!(await commandExists("arduino-cli"))) {
    fail(
      "arduino-cli is not on PATH.\n" +
        "Install it first: https://arduino.github.io/arduino-cli/installation/ " +
        "(or run: aiot-sdk repair, which checks for it)",
    );
  }
  // arduino-cli requires the sketch directory name to match the .ino file.
  const sketchName = `${basename(dir)}.ino`;
  if (!existsSync(join(dir, sketchName))) {
    const inos = readdirSync(dir).filter((f) => f.endsWith(".ino"));
    const hint =
      inos.length === 1
        ? `Found ${inos[0]} — rename the directory to "${inos[0].replace(/\.ino$/, "")}" (directory name must match the .ino name).`
        : `Expected ${sketchName} in ${dir}.`;
    fail(`Not a valid Arduino sketch directory. ${hint}`);
  }
  const cfg = loadProjectConfig(projectDir);
  const fqbn = projectFqbn(cfg);
  const args = ["compile", "--fqbn", fqbn, "--export-binaries", projectDir];
  if (opts.verbose) console.log(`$ arduino-cli ${args.join(" ")}`);
  const r = await run("arduino-cli", args, { cwd: projectDir });
  const output = `${r.stdout}\n${r.stderr}`;
  const hints = r.code === 0 ? [] : parseCompileErrors(output);
  return { ok: r.code === 0, hints, stdout: r.stdout, stderr: r.stderr };
}

export function printCompileResult(result: CompileResult): void {
  if (result.ok) {
    console.log("Build passed.");
    return;
  }
  console.error("\nBuild failed.");
  for (const hint of result.hints) {
    console.error(`\nHint: ${hint}`);
  }
  console.error("\n--- Technical details (raw compiler output) ---");
  const raw = `${result.stdout}\n${result.stderr}`.trim();
  console.error(raw.length > 0 ? raw : "(no output)");
}

export function registerBuild(program: Command): void {
  program
    .command("build")
    .description("Compile the firmware in a project directory")
    .option("--project-dir <dir>", "project directory", ".")
    .option("--verbose", "print the arduino-cli invocation", false)
    .action(async (opts: { projectDir: string; verbose: boolean }) => {
      header("build");
      let cfg;
      try {
        cfg = loadProjectConfig(opts.projectDir);
      } catch (e) {
        fail((e as Error).message);
      }
      console.log(`Project: ${cfg.deviceName} (${cfg.deviceId})`);
      console.log(`FQBN:    ${projectFqbn(cfg)}`);
      const result = await compileProject(opts.projectDir, { verbose: opts.verbose });
      printCompileResult(result);
      if (!result.ok) process.exit(1);
    });
}
