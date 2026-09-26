/**
 * Firmware codegen planning: turns sensor/actuator selections into the
 * concrete C++ snippets that main.ino.ejs splices in. Keeping this logic in
 * TypeScript (not EJS) makes it testable and keeps templates dumb.
 */
import { getSensor } from "../sensor-registry/index.js";
import { getActuator } from "../actuator-registry/index.js";
import type { GenerateInput } from "./input.js";

export interface FirmwarePlan {
  /** e.g. ['adapters/dht22.h'] */
  includes: string[];
  /** e.g. ['Dht22Adapter dht22_0(4);'] */
  adapterDecls: string[];
  /** e.g. ['dht22_0.begin();'] */
  adapterBegins: string[];
  /** device.sensor(...) lines */
  sensorRegisters: string[];
  /** static helper functions (servo PWM) placed before setup() */
  actuatorHelpers: string[];
  /** pinMode / ledc setup lines inside setup() */
  actuatorSetups: string[];
  /** device.actuator(...) lines */
  actuatorRegister: string[];
  /** rows for WIRING.md / wiring.svg */
  wiring: {
    label: string;
    kind: "sensor" | "actuator";
    pin: number;
    vcc: string;
    gnd: string;
    signal: string;
  }[];
}

function cpp(v: number): string {
  return Number.isInteger(v) ? `${v}` : `${v}`;
}

export function planFirmware(input: GenerateInput): FirmwarePlan {
  const plan: FirmwarePlan = {
    includes: [],
    adapterDecls: [],
    adapterBegins: [],
    sensorRegisters: [],
    actuatorHelpers: [],
    actuatorSetups: [],
    actuatorRegister: [],
    wiring: [],
  };
  const includeSet = new Set<string>();
  const addInclude = (h: string) => {
    if (!includeSet.has(h)) {
      includeSet.add(h);
      plan.includes.push(h);
    }
  };

  input.sensors.forEach((sel, i) => {
    const sensor = getSensor(sel.sensorId);
    if (!sensor) throw new Error(`Unknown sensor "${sel.sensorId}"`);
    const varName = `${sensor.adapter}_${i}`;
    addInclude(`adapters/${sensor.adapter}.h`);

    if (sensor.adapter === "dht22") {
      plan.adapterDecls.push(`Dht22Adapter ${varName}(${sel.pin});`);
    } else if (sensor.adapter === "analog") {
      plan.adapterDecls.push(`AnalogAdapter ${varName}(${sel.pin});`);
    } else {
      plan.adapterDecls.push(`DigitalAdapter ${varName}(${sel.pin});`);
    }
    plan.adapterBegins.push(`${varName}.begin();`);

    for (const cap of sensor.capabilitiesProduced) {
      const interval = cap.samplingInterval ?? 10000;
      let expr: string;
      if (sel.sensorId === "dht22") {
        expr =
          cap.id === "temperature"
            ? `${varName}.readTemperature()`
            : `${varName}.readHumidity()`;
      } else if (sensor.adapter === "analog") {
        expr = `${varName}.readVoltage()`;
      } else {
        expr = `${varName}.read() ? 1.0f : 0.0f`;
      }
      plan.sensorRegisters.push(
        `device.sensor("${cap.id}", []() -> float { return ${expr}; }, ${interval});`,
      );
    }

    plan.wiring.push({
      label: sensor.name,
      kind: "sensor",
      pin: sel.pin,
      vcc: sensor.wiring.vcc,
      gnd: sensor.wiring.gnd,
      signal: sensor.wiring.signal,
    });
  });

  let pwmChannel = 0;
  input.actuators.forEach((sel, i) => {
    const actuator = getActuator(sel.actuatorId);
    if (!actuator) throw new Error(`Unknown actuator "${sel.actuatorId}"`);
    const capId = actuator.capability.id;
    const pin = sel.pin;

    if (actuator.fnType === "bool") {
      plan.actuatorSetups.push(`pinMode(${pin}, OUTPUT);`);
      const safe = actuator.safeDefault === true ? "true" : "false";
      plan.actuatorRegister.push(
        `device.actuator("${capId}", [](bool on) { digitalWrite(${pin}, on ? HIGH : LOW); }, ${safe});`,
      );
    } else if (sel.actuatorId === "fan_speed") {
      const ch = pwmChannel++;
      const freq = 25000;
      const bits = 8;
      plan.actuatorSetups.push(
        `#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)`,
        `  ledcAttach(${pin}, ${freq}, ${bits});`,
        `#else`,
        `  ledcSetup(${ch}, ${freq}, ${bits});`,
        `  ledcAttachPin(${pin}, ${ch});`,
        `#endif`,
      );
      const write3 = `ledcWrite(${pin}, (uint32_t)(v * 255.0f / 100.0f))`;
      const write2 = `ledcWrite(${ch}, (uint32_t)(v * 255.0f / 100.0f))`;
      plan.actuatorRegister.push(
        `#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)`,
        `  device.actuator("${capId}", [](float v) { ${write3}; }, 0, 100, 0);`,
        `#else`,
        `  device.actuator("${capId}", [](float v) { ${write2}; }, 0, 100, 0);`,
        `#endif`,
      );
    } else if (sel.actuatorId === "servo") {
      const ch = pwmChannel++;
      const helper = `servoWrite_${i}`;
      const bits = 12;
      plan.actuatorSetups.push(
        `#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)`,
        `  ledcAttach(${pin}, 50, ${bits});`,
        `#else`,
        `  ledcSetup(${ch}, 50, ${bits});`,
        `  ledcAttachPin(${pin}, ${ch});`,
        `#endif`,
      );
      // 50 Hz -> 20 ms period; 1.0–2.0 ms pulse; 12-bit duty.
      plan.actuatorHelpers.push(
        `static void ${helper}(float angle) {`,
        `  uint32_t duty = (uint32_t)((1000.0f + angle / 180.0f * 1000.0f) / 20000.0f * 4095.0f);`,
        `#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)`,
        `  ledcWrite(${pin}, duty);`,
        `#else`,
        `  ledcWrite(${ch}, duty);`,
        `#endif`,
        `}`,
      );
      plan.actuatorRegister.push(
        `device.actuator("${capId}", ${helper}, 0, 180, ${cpp(Number(actuator.safeDefault))});`,
      );
    } else {
      // Generic numeric actuator on a PWM pin.
      const ch = pwmChannel++;
      plan.actuatorSetups.push(
        `#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)`,
        `  ledcAttach(${pin}, 5000, 8);`,
        `#else`,
        `  ledcSetup(${ch}, 5000, 8);`,
        `  ledcAttachPin(${pin}, ${ch});`,
        `#endif`,
      );
      const min = actuator.capability.min ?? 0;
      const max = actuator.capability.max ?? 100;
      plan.actuatorRegister.push(
        `device.actuator("${capId}", [](float v) {`,
        `#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)`,
        `  ledcWrite(${pin}, (uint32_t)((v - (${min})) / ((${max}) - (${min})) * 255.0f));`,
        `#else`,
        `  ledcWrite(${ch}, (uint32_t)((v - (${min})) / ((${max}) - (${min})) * 255.0f));`,
        `#endif`,
        `}, ${min}, ${max}, ${cpp(Number(actuator.safeDefault))});`,
      );
    }

    plan.wiring.push({
      label: actuator.name,
      kind: "actuator",
      pin: sel.pin,
      vcc: actuator.wiring.vcc,
      gnd: actuator.wiring.gnd,
      signal: actuator.wiring.signal,
    });
  });

  return plan;
}
