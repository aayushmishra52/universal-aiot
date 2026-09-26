/**
 * EJS project rendering. Templates live in <package>/templates/esp32 and are
 * resolved relative to the package root, so rendering works both from src/
 * (vitest) and dist/ (built CLI).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { getBoard } from "../board-registry/index.js";
import { defaultLibraryDir } from "../arduino-dirs.js";
import { buildManifest } from "./manifest.js";
import { planFirmware } from "./firmware.js";
import { validateGenerateInput, type GenerateInput } from "./input.js";
import { PINNED_VERSIONS } from "../versions.js";

export const GENERATOR_VERSION = "1.0.0";

/**
 * Filesystem/Arduino-safe slug for the sketch: the .ino is always named
 * `<deviceSlug>.ino`, and `create` defaults --out to `./<deviceSlug>` so the
 * sketch directory name matches (required by arduino-cli).
 */
export function deviceSlugFor(deviceName: string, deviceId: string): string {
  let slug = deviceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) slug = deviceId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!/^[a-z]/.test(slug)) slug = `aiot-${slug}`;
  return slug.slice(0, 48) || "aiot-device";
}

export interface RenderedFile {
  /** Path relative to the project root, e.g. "main.ino". */
  path: string;
  content: string;
}

/** Locate the @aiot/sdk-generator package root from any src/dist location. */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "@aiot/sdk-generator") return dir;
      } catch {
        /* keep walking up */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Could not locate @aiot/sdk-generator package root");
    dir = parent;
  }
}

export function templateRoot(): string {
  return join(packageRoot(), "templates", "esp32");
}

function collectTemplates(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTemplates(full, base, out);
    } else if (entry.endsWith(".ejs")) {
      out.push(full);
    }
  }
}

/** Render every template to an in-memory file list (no disk writes). */
export function renderProject(input: GenerateInput): RenderedFile[] {
  const { errors } = validateGenerateInput(input);
  if (errors.length > 0) {
    throw new Error(`Invalid input:\n- ${errors.join("\n- ")}`);
  }
  const board = getBoard(input.boardId);
  if (!board) throw new Error(`Unknown board "${input.boardId}"`);

  const manifest = buildManifest(input);
  const manifestJson = JSON.stringify(manifest, null, 2);
  const plan = planFirmware(input);
  const deviceSlug = deviceSlugFor(input.deviceName, input.deviceId);

  const data = {
    generatorVersion: GENERATOR_VERSION,
    deviceId: input.deviceId,
    projectId: input.projectId,
    orgId: input.orgId,
    deviceName: input.deviceName,
    deviceSlug,
    firmwareVersion: input.firmwareVersion,
    boardId: board.id,
    board,
    mqttHost: input.mqttHost,
    mqttPort: input.mqttPort,
    mqttUser: input.mqttUser,
    mqttPass: input.mqttPass,
    wifiSsid: input.wifiSsid,
    wifiPass: input.wifiPass,
    tls: input.tls,
    versions: PINNED_VERSIONS,
    // Sketchbook libraries dir for the sketch.yaml `- dir:` references.
    libraryDir: input.libraryDir ?? defaultLibraryDir(),
    // Platform reference (packager:architecture) for the sketch profile.
    // Deliberately versionless so the build uses the system-installed core.
    platformRef: board.fqbn.split(":").slice(0, 2).join(":"),
    manifest,
    manifestJson,
    plan,
    // aiot.config.json (generator input — never secrets)
    projectConfig: {
      version: 1,
      generator: "aiot-sdk",
      deviceName: input.deviceName,
      deviceId: input.deviceId,
      projectId: input.projectId,
      orgId: input.orgId,
      board: board.id,
      firmwareVersion: input.firmwareVersion,
      mqtt: { host: input.mqttHost, port: input.mqttPort, tls: input.tls },
      sensors: input.sensors.map((s) => ({ sensor: s.sensorId, pin: s.pin })),
      actuators: input.actuators.map((a) => ({ actuator: a.actuatorId, pin: a.pin })),
    },
  };

  const root = templateRoot();
  const templates: string[] = [];
  collectTemplates(root, root, templates);
  templates.sort();

  return templates.map((full) => {
    let rel = relative(root, full).replace(/\.ejs$/, "");
    // The sketch entry point must be named after the project directory for
    // arduino-cli (sketch dir name == .ino name).
    if (rel === "sketch.ino") rel = `${deviceSlug}.ino`;
    const template = readFileSync(full, "utf8");
    // escape: identity — templates emit C++/JSON/YAML/Markdown, never HTML,
    // so EJS's XML escaping would corrupt quotes and arrows.
    const content = ejs.render(template, data, {
      filename: full,
      escape: (markup: unknown) => String(markup ?? ""),
    });
    return { path: rel, content };
  });
}

/** Render and write the project to outDir. Returns written file paths. */
export function writeProject(input: GenerateInput): { outDir: string; files: string[] } {
  const outDir = resolve(input.outDir);
  const files = renderProject(input);
  const written: string[] = [];
  for (const file of files) {
    const dest = join(outDir, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content, "utf8");
    written.push(dest);
  }
  return { outDir, files: written };
}
