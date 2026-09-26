/**
 * `aiot-sdk repair` — install the pinned ESP32 core and libraries.
 *
 * Never deletes user config; it only installs/updates tooling.
 * espMqttClient is not in the Arduino Library Manager index, so it is
 * installed from the pinned upstream GitHub release (v1.7.3).
 */
import type { Command } from "commander";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { PINNED_VERSIONS } from "../versions.js";
import { commandExists, run, fail, header, resolveLibraryDir } from "./util.js";

const ESP_MQTT_CLIENT_URL = `https://github.com/bertmelis/espMqttClient/archive/refs/tags/v${PINNED_VERSIONS.espMqttClient}.zip`;

async function ensureArduinoCli(): Promise<void> {
  if (await commandExists("arduino-cli")) return;
  fail(
    "arduino-cli is not on PATH.\n" +
      "Install it first: https://arduino.github.io/arduino-cli/installation/ " +
      "(or: curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh)",
  );
}

/** Install a zip library into the sketchbook libraries dir via curl+unzip. */
async function installZipLibrary(
  name: string,
  url: string,
  destDirName: string,
  librariesDir: string,
  extractedDirName: string,
): Promise<boolean> {
  const libDir = join(librariesDir, destDirName);
  if (existsSync(join(libDir, "library.properties")) || existsSync(libDir)) {
    console.log(`  ✓ ${name} already present at ${libDir}`);
    return true;
  }
  console.log(`  … installing ${name} from ${url}`);
  const tmpZip = join(homedir(), ".arduino15", "staging", `${destDirName}.zip`);
  mkdirSync(join(homedir(), ".arduino15", "staging"), { recursive: true });
  const dl = await run("curl", ["-fsSL", "--retry", "3", "-o", tmpZip, url]);
  if (dl.code !== 0) {
    console.error(`  ✗ download failed for ${name}`);
    return false;
  }
  const unzip = await run("unzip", ["-q", "-o", tmpZip, "-d", librariesDir]);
  if (unzip.code !== 0) {
    console.error(`  ✗ unzip failed for ${name}`);
    return false;
  }
  // GitHub zips extract to <repo>-<tag>/; normalise to the library dir name.
  const extracted = join(librariesDir, extractedDirName);
  if (existsSync(extracted) && !existsSync(libDir)) {
    const mv = await run("sh", ["-c", `mv "${extracted}" "${libDir}"`]);
    if (mv.code !== 0) {
      console.error(`  ✗ could not rename extracted dir for ${name}`);
      return false;
    }
  }
  console.log(`  ✓ ${name} installed`);
  return true;
}

export function registerRepair(program: Command): void {
  program
    .command("repair")
    .description("Install the pinned ESP32 core and libraries (never touches your config)")
    .action(async () => {
      header("repair");
      await ensureArduinoCli();
      let ok = true;

      console.log(`\nESP32 core ${PINNED_VERSIONS.esp32Core}:`);
      const core = await run("arduino-cli", [
        "core", "install", `esp32:esp32@${PINNED_VERSIONS.esp32Core}`,
      ]);
      if (core.code === 0) {
        console.log("  ✓ esp32 core installed");
      } else {
        ok = false;
        console.error("  ✗ core install failed");
        console.error(core.stderr.split("\n").slice(-5).join("\n"));
      }

      console.log(`\nLibraries:`);
      const libs: [string, string][] = [
        ["ArduinoJson", PINNED_VERSIONS.arduinoJson],
        ["DHT sensor library", PINNED_VERSIONS.dhtSensor],
        ["Adafruit Unified Sensor", PINNED_VERSIONS.adafruitUnified],
        ["AsyncTCP", PINNED_VERSIONS.asyncTcp],
      ];
      for (const [name, version] of libs) {
        const r = await run("arduino-cli", ["lib", "install", `${name}@${version}`]);
        if (r.code === 0) {
          console.log(`  ✓ ${name}@${version}`);
        } else if (/already installed/i.test(`${r.stdout} ${r.stderr}`)) {
          console.log(`  ✓ ${name}@${version} (already installed)`);
        } else {
          ok = false;
          console.error(`  ✗ ${name}@${version} failed`);
        }
      }

      console.log(`\nespMqttClient ${PINNED_VERSIONS.espMqttClient} (GitHub release, not in Library Manager):`);
      const librariesDir = await resolveLibraryDir();
      const zipOk = await installZipLibrary(
        `espMqttClient@${PINNED_VERSIONS.espMqttClient}`,
        ESP_MQTT_CLIENT_URL,
        "espMqttClient",
        librariesDir,
        `espMqttClient-${PINNED_VERSIONS.espMqttClient}`,
      );
      if (!zipOk) ok = false;

      if (!ok) {
        fail("repair finished with errors — see above.");
      }
      console.log("\nRepair complete. Your project config was not modified.");
    });
}
