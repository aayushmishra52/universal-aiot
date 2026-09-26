/**
 * `aiot-sdk package` — bundle a project into a distributable archive.
 *
 * Creates dist/<name>-v<version>.tar.gz (via the system `tar`) containing
 * firmware sources, firmware.bin when built, manifest, docs, test reports
 * and a sha256 checksums.txt.
 */
import type { Command } from "commander";
import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { loadProjectConfig, run, fail, header } from "./util.js";

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === ".git" || entry === "node_modules") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
}

/** Firmware binary produced by --export-binaries, if any. */
function findFirmwareBin(projectDir: string): string | null {
  const buildDir = join(projectDir, "build");
  if (!existsSync(buildDir)) return null;
  const bins: string[] = [];
  walk(buildDir, bins);
  const bin = bins.find((f) => f.endsWith(".bin"));
  return bin ?? null;
}

const SOURCE_EXTS = new Set([".ino", ".h", ".cpp", ".c", ".json", ".yaml", ".md", ".svg"]);

export function registerPackage(program: Command): void {
  program
    .command("package")
    .description("Bundle the project into a distributable archive (tar.gz + sha256)")
    .option("--project-dir <dir>", "project directory", ".")
    .action(async (opts: { projectDir: string }) => {
      header("package");
      const dir = resolve(opts.projectDir);
      let cfg;
      try {
        cfg = loadProjectConfig(dir);
      } catch (e) {
        fail((e as Error).message);
      }

      const slug = cfg.deviceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "aiot-device";
      const distDir = join(dir, "dist");
      mkdirSync(distDir, { recursive: true });
      const archiveName = `${slug}-v${cfg.firmwareVersion}.tar.gz`;
      const archivePath = join(distDir, archiveName);

      // Stage files (never include config/config.h — real secrets).
      const stage = mkdtempSync(join(tmpdir(), "aiot-pkg-"));
      try {
        const all: string[] = [];
        walk(dir, all);
        const staged: string[] = [];
        for (const f of all) {
          const rel = relative(dir, f);
          if (rel.startsWith("build/") || rel.startsWith("dist/") || rel === "config/config.h") continue;
          const ext = rel.includes(".") ? rel.slice(rel.lastIndexOf(".")) : "";
          if (!SOURCE_EXTS.has(ext)) continue;
          const dest = join(stage, rel);
          mkdirSync(join(dest, ".."), { recursive: true });
          writeFileSync(dest, readFileSync(f));
          staged.push(rel);
        }
        const bin = findFirmwareBin(dir);
        if (bin) {
          const dest = join(stage, "firmware.bin");
          writeFileSync(dest, readFileSync(bin));
          staged.push("firmware.bin");
          console.log(`Including firmware binary: ${relative(dir, bin)}`);
        } else {
          console.log("No firmware.bin found (run aiot-sdk build first) — packaging sources only.");
        }

        // checksums.txt (sha256 over staged files)
        const sums: string[] = [];
        for (const rel of staged.sort()) {
          const hash = createHash("sha256").update(readFileSync(join(stage, rel))).digest("hex");
          sums.push(`${hash}  ${rel}`);
        }
        writeFileSync(join(stage, "checksums.txt"), sums.join("\n") + "\n", "utf8");

        const tar = await run("tar", ["-czf", archivePath, "-C", stage, "."]);
        if (tar.code !== 0) {
          fail(`tar failed: ${tar.stderr}`);
        }
        const sha = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
        console.log(`\nWrote ${archivePath}`);
        console.log(`sha256: ${sha}`);
        console.log(`Files: ${staged.length + 1} (incl. checksums.txt)`);
      } finally {
        rmSync(stage, { recursive: true, force: true });
      }
    });
}
