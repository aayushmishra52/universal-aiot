import { describe, expect, it } from "vitest";
import { getBoard, validatePin, boardIds } from "../src/board-registry/index.js";
import {
  validateGenerateInput,
  DEVICE_ID_REGEX,
  type GenerateInput,
} from "../src/generate/input.js";

function baseInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    boardId: "esp32",
    deviceId: "DEV-9K2QX7",
    projectId: "project-1",
    orgId: "org-1",
    deviceName: "Test Device",
    firmwareVersion: "1.0.0",
    sensors: [{ sensorId: "dht22", pin: 4 }],
    actuators: [{ actuatorId: "led", pin: 2 }],
    mqttHost: "localhost",
    mqttPort: 1883,
    mqttUser: "",
    mqttPass: "",
    wifiSsid: "",
    wifiPass: "",
    tls: false,
    outDir: "/tmp/aiot-test-out",
    ...overrides,
  };
}

describe("board registry", () => {
  it("knows all four boards with ESP32 FQBNs", () => {
    expect(boardIds().sort()).toEqual(["esp32", "esp32c3", "esp32c6", "esp32s3"]);
    expect(getBoard("esp32")?.fqbn).toBe("esp32:esp32:esp32");
    expect(getBoard("esp32c3")?.fqbn).toBe("esp32:esp32:esp32c3");
    expect(getBoard("esp32s3")?.fqbn).toBe("esp32:esp32:esp32s3");
    expect(getBoard("esp32c6")?.fqbn).toBe("esp32:esp32:esp32c6");
  });

  it("accepts a normal pin", () => {
    expect(validatePin("esp32", 4, "digital")).toEqual({ ok: true });
  });

  it("rejects reserved flash/PSRAM pins", () => {
    for (const pin of [6, 7, 8, 9, 10, 11]) {
      const r = validatePin("esp32", pin, "digital");
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/reserved/i);
    }
  });

  it("rejects non-ADC pins for adc usage", () => {
    const r = validatePin("esp32", 4, "adc");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ADC/i);
    expect(validatePin("esp32", 34, "adc").ok).toBe(true);
  });

  it("rejects input-only pins for pwm", () => {
    const r = validatePin("esp32", 34, "pwm");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/input-only/);
  });

  it("warns (but accepts) strapping pins", () => {
    const r = validatePin("esp32", 0, "digital");
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/strapping/i);
  });

  it("rejects unknown boards and bad pins", () => {
    expect(validatePin("esp99", 4, "digital").ok).toBe(false);
    expect(validatePin("esp32", 99, "digital").ok).toBe(false);
    expect(validatePin("esp32", -1, "digital").ok).toBe(false);
  });
});

describe("create input validation", () => {
  it("accepts the golden input", () => {
    const { errors } = validateGenerateInput(baseInput());
    expect(errors).toEqual([]);
  });

  it("rejects bad device ids", () => {
    for (const bad of ["dev-123", "DEV-abc", "DEV-1", "DEV-TOOLONG1234567", "X"]) {
      expect(DEVICE_ID_REGEX.test(bad)).toBe(false);
      const { errors } = validateGenerateInput(baseInput({ deviceId: bad }));
      expect(errors.some((e) => e.includes("device id"))).toBe(true);
    }
    expect(DEVICE_ID_REGEX.test("DEV-9K2QX7")).toBe(true);
  });

  it("rejects duplicate pins", () => {
    const { errors } = validateGenerateInput(
      baseInput({
        sensors: [{ sensorId: "dht22", pin: 4 }],
        actuators: [{ actuatorId: "led", pin: 4 }],
      }),
    );
    expect(errors.some((e) => e.includes("assigned twice"))).toBe(true);
  });

  it("rejects reserved pins with a helpful reason", () => {
    const { errors } = validateGenerateInput(
      baseInput({ sensors: [{ sensorId: "dht22", pin: 6 }] }),
    );
    expect(errors.some((e) => /reserved/i.test(e))).toBe(true);
  });

  it("rejects duplicate capabilities (dht22 + temperature)", () => {
    const { errors } = validateGenerateInput(
      baseInput({
        sensors: [
          { sensorId: "dht22", pin: 4 },
          { sensorId: "temperature", pin: 34 },
        ],
      }),
    );
    expect(errors.some((e) => e.includes('"temperature"') && e.includes("twice"))).toBe(true);
  });

  it("rejects unknown board/sensor/actuator and empty selections", () => {
    expect(validateGenerateInput(baseInput({ boardId: "nope" })).errors.length).toBeGreaterThan(0);
    expect(
      validateGenerateInput(baseInput({ sensors: [{ sensorId: "nope", pin: 4 }] })).errors.length,
    ).toBeGreaterThan(0);
    expect(
      validateGenerateInput(baseInput({ actuators: [{ actuatorId: "nope", pin: 2 }] })).errors.length,
    ).toBeGreaterThan(0);
    expect(
      validateGenerateInput(baseInput({ sensors: [], actuators: [] })).errors.some((e) =>
        e.includes("at least one"),
      ),
    ).toBe(true);
  });

  it("rejects bad mqtt port", () => {
    const { errors } = validateGenerateInput(baseInput({ mqttPort: 99999 }));
    expect(errors.some((e) => e.includes("MQTT port"))).toBe(true);
  });
});
