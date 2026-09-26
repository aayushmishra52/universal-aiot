/**
 * `aiot-sdk test` — the device test pipeline:
 *   1. static validation (manifest schema, config, secret scan)
 *   2. compile (arduino-cli)
 *   3. protocol test (manifest + topic scheme)
 *   4. simulator test (in-process MQTT round-trip)
 *   5. TEST-REPORT.json + TEST-REPORT.md with the publish gate
 */
import type { Command } from "commander";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  DeviceManifestSchema,
  parseTopic,
  topicTelemetry,
  type DeviceManifest,
} from "@aiot/contracts";
import { compileProject, printCompileResult } from "./build.js";
import { loadProjectConfig, run, fail, header } from "./util.js";
import { scanFiles } from "../secret-scan.js";
import { runSimulatorTest, type SimulatorCheck } from "../simulator.js";

export interface GateStep {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface TestReport {
  generatedAt: string;
  generator: string;
  project: { deviceId: string; deviceName: string; board: string };
  steps: GateStep[];
  verdict: "PUBLISHABLE" | "HOLD";
  hardwareSmokeTest: "not_run";
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "build" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
}

/** Files to secret-scan: git-tracked when possible, else the whole tree. */
async function filesForSecretScan(projectDir: string): Promise<{ path: string; relativePath: string }[]> {
  const git = await run("git", ["ls-files"], { cwd: projectDir });
  if (git.code === 0 && git.stdout.trim()) {
    return git.stdout
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => ({ path: join(projectDir, f), relativePath: f }))
      .filter((f) => existsSync(f.path) && statSync(f.path).isFile());
  }
  const all: string[] = [];
  walk(projectDir, all);
  return all.map((p) => ({ path: p, relativePath: relative(projectDir, p) }));
}

function writeReports(projectDir: string, report: TestReport): void {
  const jsonPath = join(projectDir, "TEST-REPORT.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const lines: string[] = [
    `# Test report — ${report.project.deviceName} (\`${report.project.deviceId}\`)`,
    ``,
    `Generated ${report.generatedAt} by aiot-sdk ${report.generator}.`,
    ``,
    `## Publish gate`,
    ``,
    `| Step | Result | Detail |`,
    `|------|--------|--------|`,
  ];
  for (const s of report.steps) {
    lines.push(`| ${s.name} | ${s.passed ? "✅ pass" : "❌ fail"} | ${s.detail ?? ""} |`);
  }
  lines.push(
    ``,
    `**Verdict: ${report.verdict}**`,
    ``,
    `- HARDWARE_SMOKE_TEST: \`${report.hardwareSmokeTest}\` — flash real hardware and follow TESTING.md before shipping.`,
    ``,
  );
  writeFileSync(join(projectDir, "TEST-REPORT.md"), lines.join("\n"), "utf8");
  console.log(`\nReports written: TEST-REPORT.json, TEST-REPORT.md`);
}

export async function runTestPipeline(projectDir: string): Promise<TestReport> {
  const dir = resolve(projectDir);
  const cfg = loadProjectConfig(dir);
  const steps: GateStep[] = [];
  const push = (name: string, passed: boolean, detail?: string) => {
    steps.push({ name, passed, detail });
    console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // -- Step 1: static validation -------------------------------------------
  header("1/4 static validation");
  let manifest: DeviceManifest | null = null;
  try {
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error("manifest.json not found");
    manifest = DeviceManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    push("manifest schema", true, `${manifest.capabilities.length} capabilities`);
  } catch (e) {
    push("manifest schema", false, (e as Error).message);
  }
  push("project config", true, "config/aiot.config.json present");

  const findings = scanFiles(await filesForSecretScan(dir));
  push(
    "secret scan",
    findings.length === 0,
    findings.length === 0
      ? "no secrets in tracked files"
      : findings.map((f) => `${f.file}:${f.line} (${f.pattern})`).join("; "),
  );

  // -- Step 2: compile -------------------------------------------------------
  header("2/4 compile");
  const compile = await compileProject(dir);
  push("compile", compile.ok, compile.ok ? "arduino-cli build passed" : "see hints below");
  if (!compile.ok) printCompileResult(compile);

  // -- Step 3: protocol test -------------------------------------------------
  header("3/4 protocol test");
  if (manifest) {
    const t = topicTelemetry(cfg.orgId, cfg.projectId, cfg.deviceId);
    const parsed = parseTopic(t);
    const ok =
      parsed !== null &&
      parsed.orgId === cfg.orgId &&
      parsed.projectId === cfg.projectId &&
      parsed.deviceId === cfg.deviceId &&
      parsed.kind === "telemetry";
    push("protocol topics", ok, t);
  } else {
    push("protocol topics", false, "no valid manifest");
  }

  // -- Step 4: simulator test ------------------------------------------------
  header("4/4 simulator test");
  let simChecks: SimulatorCheck[] = [];
  if (manifest) {
    const sim = await runSimulatorTest(manifest, {
      orgId: cfg.orgId,
      projectId: cfg.projectId,
    });
    simChecks = sim.checks;
    push("simulator round-trip", sim.passed, `${sim.checks.filter((c) => c.passed).length}/${sim.checks.length} checks`);
    for (const c of sim.checks) {
      if (!c.passed) console.log(`      ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  } else {
    push("simulator round-trip", false, "no valid manifest");
  }

  const verdict: TestReport["verdict"] = steps.every((s) => s.passed) ? "PUBLISHABLE" : "HOLD";
  const report: TestReport = {
    generatedAt: new Date().toISOString(),
    generator: "1.0.0",
    project: { deviceId: cfg.deviceId, deviceName: cfg.deviceName, board: cfg.board },
    steps,
    verdict,
    hardwareSmokeTest: "not_run",
  };
  writeReports(dir, report);

  header("publish gate");
  for (const s of steps) {
    console.log(`  ${s.passed ? "✅" : "❌"} ${s.name}`);
  }
  console.log(`\nVerdict: ${verdict}`);
  console.log(`HARDWARE_SMOKE_TEST: not_run`);
  return report;
}

export function registerTest(program: Command): void {
  program
    .command("test")
    .description("Run the full device test pipeline (static, compile, protocol, simulator)")
    .option("--project-dir <dir>", "project directory", ".")
    .action(async (opts: { projectDir: string }) => {
      try {
        const report = await runTestPipeline(opts.projectDir);
        if (report.verdict !== "PUBLISHABLE") process.exit(1);
      } catch (e) {
        fail((e as Error).message);
      }
    });
}
