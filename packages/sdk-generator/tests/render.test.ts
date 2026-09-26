import { describe, expect, it } from "vitest";
import { renderProject } from "../src/generate/render.js";
import { buildManifest } from "../src/generate/manifest.js";
import { DeviceManifestSchema } from "@aiot/contracts";
import type { GenerateInput } from "../src/generate/input.js";

export function goldenInput(): GenerateInput {
  return {
    boardId: "esp32",
    deviceId: "DEV-GOLD1",
    projectId: "project-golden",
    orgId: "org-golden",
    deviceName: "Golden Room",
    firmwareVersion: "1.0.0",
    sensors: [{ sensorId: "dht22", pin: 4 }],
    actuators: [{ actuatorId: "led", pin: 2 }],
    mqttHost: "localhost",
    mqttPort: 1883,
    mqttUser: "",
    mqttPass: "",
    wifiSsid: "TestSSID",
    wifiPass: "TestPass",
    tls: false,
    outDir: "/tmp/aiot-golden",
  };
}

describe("render determinism", () => {
  it("produces byte-identical output for the same input", () => {
    const a = renderProject(goldenInput());
    const b = renderProject(goldenInput());
    expect(a.map((f) => f.path).sort()).toEqual(b.map((f) => f.path).sort());
    for (const fa of a) {
      const fb = b.find((f) => f.path === fa.path)!;
      // Same input must produce identical bytes — no timestamps anywhere.
      expect(fb.content, fa.path).toBe(fa.content);
    }
  });

  it("renders all expected project files", () => {
    const paths = renderProject(goldenInput()).map((f) => f.path);
    for (const expected of [
      "golden-room.ino",
      "AIoT.h",
      "AIoT.cpp",
      "adapters/dht22.h",
      "adapters/analog.h",
      "adapters/digital.h",
      "config/aiot.config.json",
      "config/config.h",
      "config/config.example.h",
      "sketch.yaml",
      "manifest.json",
      "manifest_json.h",
      "WIRING.md",
      "README.md",
      "TESTING.md",
      ".gitignore",
      "pinout.json",
      "wiring.svg",
    ]) {
      expect(paths, `missing ${expected}`).toContain(expected);
    }
  });

  it("wires the golden selections into the sketch", () => {
    const files = renderProject(goldenInput());
    const main = files.find((f) => f.path === "golden-room.ino")!.content;
    expect(main).toContain('device.sensor("temperature"');
    expect(main).toContain('device.sensor("humidity"');
    expect(main).toContain('device.actuator("led"');
    expect(main).toContain("Dht22Adapter dht22_0(4);");
    expect(main).toContain("digitalWrite(2,");
    expect(main).toContain('cfg.manifestJson = MANIFEST_JSON;');
  });

  it("embeds the identical manifest in manifest.json and manifest_json.h", () => {
    const files = renderProject(goldenInput());
    const manifestJson = files.find((f) => f.path === "manifest.json")!.content;
    const header = files.find((f) => f.path === "manifest_json.h")!.content;
    const m = header.match(/R"AIOTJSON\(([\s\S]*)\)AIOTJSON"/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(JSON.parse(manifestJson));
  });

  it("generates a sketch.yaml that builds offline (system platform + dir libraries)", () => {
    const files = renderProject({ ...goldenInput(), libraryDir: "/home/testuser/Arduino/libraries" });
    const yaml = files.find((f) => f.path === "sketch.yaml")!.content;
    // Versionless platform reference: arduino-cli uses the system-installed
    // core instead of re-downloading it into an isolated profile cache.
    expect(yaml).toContain("- platform: esp32:esp32\n");
    expect(yaml).not.toMatch(/platform: esp32:esp32 \(/);
    // Libraries by directory: no Library Manager downloads at build time.
    expect(yaml).toContain("- dir: /home/testuser/Arduino/libraries/ArduinoJson");
    expect(yaml).toContain("- dir: /home/testuser/Arduino/libraries/espMqttClient");
    expect(yaml).toContain("- dir: /home/testuser/Arduino/libraries/AsyncTCP");
    expect(yaml).toContain("- dir: /home/testuser/Arduino/libraries/DHT_sensor_library");
    expect(yaml).toContain("- dir: /home/testuser/Arduino/libraries/Adafruit_Unified_Sensor");
    // Pinned versions are documented in comments.
    expect(yaml).toContain("7.3.2");
    expect(yaml).toContain("1.7.3");
    expect(yaml).toContain("fqbn: esp32:esp32:esp32");
    expect(yaml).toContain("default_profile: esp32");
  });

  it("keeps secrets out of committed files", () => {    const files = renderProject(goldenInput());
    const configH = files.find((f) => f.path === "config/config.h")!.content;
    expect(configH).toContain("TestPass");
    for (const f of files) {
      if (f.path === "config/config.h") continue;
      expect(f.content, f.path).not.toContain("TestPass");
    }
    const aiotConfig = files.find((f) => f.path === "config/aiot.config.json")!.content;
    expect(aiotConfig).not.toContain("TestPass");
  });
});

describe("manifest generation", () => {
  it("builds a manifest that validates against DeviceManifestSchema", () => {
    const manifest = buildManifest(goldenInput());
    const parsed = DeviceManifestSchema.parse(manifest);
    expect(parsed.deviceId).toBe("DEV-GOLD1");
    expect(parsed.protocolVersion).toBe("1.0");
    const ids = parsed.capabilities.map((c) => c.id).sort();
    expect(ids).toEqual(["humidity", "led", "temperature"]);
    const led = parsed.capabilities.find((c) => c.id === "led")!;
    expect(led.kind).toBe("actuator");
    expect(led.type).toBe("boolean");
  });
});
