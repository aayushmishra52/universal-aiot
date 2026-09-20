import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  topicRoot,
  topicManifest,
  topicStatus,
  topicTelemetry,
  topicCommand,
  topicPresence,
  topicHealth,
  parseTopic,
  DeviceManifestSchema,
  TelemetrySchema,
  CommandSchema,
  CommandResultSchema,
  HealthSchema,
  PresenceSchema,
  DeviceStatusSchema,
  DeviceIdentitySchema,
  PairingRequestSchema,
  PairingResultSchema,
  RegisterRequestSchema,
  LoginRequestSchema,
  AuthTokenPayloadSchema,
  RealtimeEventSchema,
  AutomationSchema,
  validateCapabilityValue,
  makeMessageId,
  isExpired,
  type Capability,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

describe("topics", () => {
  it("exposes protocol version 1.0", () => {
    expect(PROTOCOL_VERSION).toBe("1.0");
  });

  it("builds topic roots and suffix topics", () => {
    expect(topicRoot("org1", "proj1", "dev1")).toBe("aiot/v1/org1/proj1/dev1");
    expect(topicManifest("org1", "proj1", "dev1")).toBe(
      "aiot/v1/org1/proj1/dev1/manifest",
    );
    expect(topicStatus("org1", "proj1", "dev1")).toBe(
      "aiot/v1/org1/proj1/dev1/status",
    );
    expect(topicTelemetry("org1", "proj1", "dev1")).toBe(
      "aiot/v1/org1/proj1/dev1/telemetry",
    );
    expect(topicCommand("org1", "proj1", "dev1")).toBe(
      "aiot/v1/org1/proj1/dev1/command",
    );
    expect(topicPresence("org1", "proj1", "dev1")).toBe(
      "aiot/v1/org1/proj1/dev1/presence",
    );
    expect(topicHealth("org1", "proj1", "dev1")).toBe(
      "aiot/v1/org1/proj1/dev1/health",
    );
  });

  it("round-trips build -> parse for every topic kind", () => {
    const builders = [
      topicManifest,
      topicStatus,
      topicTelemetry,
      topicCommand,
      topicPresence,
      topicHealth,
    ];
    for (const build of builders) {
      const topic = build("org-9", "proj-7", "dev-3");
      const parsed = parseTopic(topic);
      expect(parsed).toEqual({
        orgId: "org-9",
        projectId: "proj-7",
        deviceId: "dev-3",
        kind: topic.split("/").pop(),
      });
    }
  });

  it("rejects invalid topics", () => {
    const invalid = [
      "",
      "aiot/v1/org1/proj1", // missing deviceId + kind
      "aiot/v1/org1/proj1/dev1", // missing kind
      "aiot/v1/org1/proj1/dev1/bogus", // unknown kind
      "aiot/v2/org1/proj1/dev1/telemetry", // wrong protocol version
      "aiot/v1/org1//dev1/telemetry", // empty segment
      "aiot/v1/org1/proj1/dev1/telemetry/extra", // extra segment
      "home/assistant/org1/proj1/dev1/telemetry", // wrong prefix
    ];
    for (const topic of invalid) {
      expect(parseTopic(topic), `topic: ${topic}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const numberCapability: Capability = {
  id: "temperature",
  name: "Temperature",
  type: "number",
  kind: "sensor",
  unit: "°C",
  min: -40,
  max: 85,
};

const enumCapability: Capability = {
  id: "mode",
  name: "Mode",
  type: "enum",
  kind: "actuator",
  enumValues: ["auto", "cool", "heat", "off"],
};

describe("DeviceManifestSchema", () => {
  const valid = {
    protocolVersion: "1.0",
    deviceId: "DEV-ABCDE",
    deviceType: "thermostat",
    manufacturer: "Acme",
    model: "T-1000",
    firmwareVersion: "1.2.3",
    capabilities: [numberCapability, enumCapability],
  };

  it("accepts a valid manifest", () => {
    expect(DeviceManifestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty capability list", () => {
    expect(
      DeviceManifestSchema.safeParse({ ...valid, capabilities: [] }).success,
    ).toBe(false);
  });

  it("rejects a wrong protocol version", () => {
    expect(
      DeviceManifestSchema.safeParse({ ...valid, protocolVersion: "2.0" })
        .success,
    ).toBe(false);
  });

  it("rejects bad capability ids", () => {
    for (const id of ["Temperature", "1temp", "temp-humidity", ""]) {
      const parsed = DeviceManifestSchema.safeParse({
        ...valid,
        capabilities: [{ ...numberCapability, id }],
      });
      expect(parsed.success, `id: ${id}`).toBe(false);
    }
  });

  it("rejects enum capabilities without enumValues", () => {
    const { enumValues: _removed, ...withoutEnum } = enumCapability;
    expect(
      DeviceManifestSchema.safeParse({
        ...valid,
        capabilities: [withoutEnum],
      }).success,
    ).toBe(false);
  });

  it("rejects min >= max", () => {
    expect(
      DeviceManifestSchema.safeParse({
        ...valid,
        capabilities: [{ ...numberCapability, min: 85, max: 85 }],
      }).success,
    ).toBe(false);
    expect(
      DeviceManifestSchema.safeParse({
        ...valid,
        capabilities: [{ ...numberCapability, min: 90, max: 85 }],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

describe("TelemetrySchema", () => {
  const valid = {
    protocolVersion: "1.0",
    deviceId: "DEV-ABCDE",
    messageId: "DEV-ABCDE-boot1-000001",
    timestamp: 1726800000000,
    timeQuality: "synchronized",
    sequence: 1,
    values: { temperature: 23.5, mode: "cool", online: true },
  };

  it("accepts valid telemetry", () => {
    expect(TelemetrySchema.safeParse(valid).success).toBe(true);
  });

  it("accepts timestamp 0 with unsynchronized quality", () => {
    expect(
      TelemetrySchema.safeParse({
        ...valid,
        timestamp: 0,
        timeQuality: "unsynchronized",
      }).success,
    ).toBe(true);
  });

  it("accepts optional quality field", () => {
    expect(
      TelemetrySchema.safeParse({ ...valid, quality: "error" }).success,
    ).toBe(true);
  });

  it("rejects negative sequence", () => {
    expect(TelemetrySchema.safeParse({ ...valid, sequence: -1 }).success).toBe(
      false,
    );
  });

  it("rejects non-scalar values", () => {
    expect(
      TelemetrySchema.safeParse({ ...valid, values: { t: [1, 2] } }).success,
    ).toBe(false);
    expect(
      TelemetrySchema.safeParse({ ...valid, values: { t: { v: 1 } } }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Command / CommandResult
// ---------------------------------------------------------------------------

describe("CommandSchema", () => {
  const valid = {
    kind: "command",
    protocolVersion: "1.0",
    commandId: "cmd-123",
    deviceId: "DEV-ABCDE",
    capabilityId: "mode",
    action: "set",
    params: { value: "cool" },
    issuedAt: 1000,
    expiresAt: 2000,
  };

  it("accepts a valid command", () => {
    expect(CommandSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects issuedAt >= expiresAt", () => {
    expect(
      CommandSchema.safeParse({ ...valid, expiresAt: 1000 }).success,
    ).toBe(false);
    expect(
      CommandSchema.safeParse({ ...valid, expiresAt: 500 }).success,
    ).toBe(false);
  });

  it("accepts empty params", () => {
    expect(CommandSchema.safeParse({ ...valid, params: {} }).success).toBe(
      true,
    );
  });

  it("accepts isExpired boundary semantics", () => {
    const cmd = CommandSchema.parse(valid);
    expect(isExpired(cmd, 1999)).toBe(false);
    expect(isExpired(cmd, 2000)).toBe(false); // exactly at expiry: not expired
    expect(isExpired(cmd, 2001)).toBe(true);
  });
});

describe("CommandResultSchema", () => {
  it("accepts a valid result", () => {
    const valid = {
      kind: "result",
      protocolVersion: "1.0",
      commandId: "cmd-123",
      deviceId: "DEV-ABCDE",
      status: "SUCCEEDED",
      reportedState: { mode: "cool" },
      at: 1500,
    };
    expect(CommandResultSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(
      CommandResultSchema.safeParse({
        kind: "result",
        protocolVersion: "1.0",
        commandId: "cmd-123",
        deviceId: "DEV-ABCDE",
        status: "DONE",
        at: 1500,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Health / Presence / Status
// ---------------------------------------------------------------------------

describe("HealthSchema", () => {
  const valid = {
    protocolVersion: "1.0",
    deviceId: "DEV-ABCDE",
    uptime: 3600,
    freeHeap: 123456,
    wifiRssi: -62,
    mqtt: "connected",
    firmware: "1.2.3",
    sensorErrors: 0,
    capabilityHealth: { temperature: "good", mode: "unknown" },
    lastTelemetryAt: 1726800000000,
    at: 1726800060000,
  };

  it("accepts a full health snapshot", () => {
    expect(HealthSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts minimal optional fields", () => {
    const { freeHeap: _fh, wifiRssi: _wr, lastTelemetryAt: _lt, ...minimal } =
      valid;
    expect(HealthSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects negative uptime and sensorErrors", () => {
    expect(HealthSchema.safeParse({ ...valid, uptime: -1 }).success).toBe(false);
    expect(HealthSchema.safeParse({ ...valid, sensorErrors: -1 }).success).toBe(
      false,
    );
  });

  it("rejects invalid mqtt state", () => {
    expect(HealthSchema.safeParse({ ...valid, mqtt: "lost" }).success).toBe(
      false,
    );
  });
});

describe("PresenceSchema", () => {
  it("accepts online/offline announcements", () => {
    for (const online of [true, false]) {
      const parsed = PresenceSchema.safeParse({
        protocolVersion: "1.0",
        deviceId: "DEV-ABCDE",
        online,
        at: 1726800060000,
      });
      expect(parsed.success).toBe(true);
    }
  });
});

describe("DeviceStatusSchema", () => {
  it("accepts every lifecycle state", () => {
    const states = [
      "BOOT",
      "SELF_TEST",
      "NETWORK_CONNECTING",
      "MQTT_CONNECTING",
      "REGISTERING",
      "ONLINE",
      "OFFLINE",
      "RECONNECTING",
    ];
    for (const state of states) {
      const parsed = DeviceStatusSchema.safeParse({
        protocolVersion: "1.0",
        deviceId: "DEV-ABCDE",
        state,
        at: 1726800060000,
      });
      expect(parsed.success, `state: ${state}`).toBe(true);
    }
  });

  it("rejects unknown states", () => {
    expect(
      DeviceStatusSchema.safeParse({
        protocolVersion: "1.0",
        deviceId: "DEV-ABCDE",
        state: "SLEEPING",
        at: 1726800060000,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auth / pairing
// ---------------------------------------------------------------------------

describe("auth schemas", () => {
  it("DeviceIdentitySchema accepts DEV- ids and rejects malformed ones", () => {
    expect(
      DeviceIdentitySchema.safeParse({
        deviceId: "DEV-ABCDE123",
        pairingUsername: "pair-abc",
      }).success,
    ).toBe(true);
    for (const deviceId of ["dev-abcde", "DEV-abc", "DEV-AB", "ABCDE", "DEV-"]) {
      expect(
        DeviceIdentitySchema.safeParse({
          deviceId,
          pairingUsername: "pair-abc",
        }).success,
        `deviceId: ${deviceId}`,
      ).toBe(false);
    }
  });

  it("PairingRequestSchema enforces min password length", () => {
    const base = {
      deviceId: "DEV-ABCDE",
      username: "user",
      password: "secret123",
    };
    expect(PairingRequestSchema.safeParse(base).success).toBe(true);
    expect(
      PairingRequestSchema.safeParse({ ...base, password: "short" }).success,
    ).toBe(false);
  });

  it("PairingResultSchema accepts valid results", () => {
    expect(
      PairingResultSchema.safeParse({
        ok: true,
        deviceId: "DEV-ABCDE",
        projectId: "proj1",
        orgId: "org1",
        rotated: true,
      }).success,
    ).toBe(true);
  });

  it("RegisterRequestSchema validates email and password length", () => {
    expect(
      RegisterRequestSchema.safeParse({
        email: "user@example.com",
        password: "secret123",
        name: "User",
      }).success,
    ).toBe(true);
    expect(
      RegisterRequestSchema.safeParse({
        email: "not-an-email",
        password: "secret123",
        name: "User",
      }).success,
    ).toBe(false);
    expect(
      RegisterRequestSchema.safeParse({
        email: "user@example.com",
        password: "short",
        name: "User",
      }).success,
    ).toBe(false);
  });

  it("LoginRequestSchema accepts valid credentials", () => {
    expect(
      LoginRequestSchema.safeParse({
        email: "user@example.com",
        password: "x",
      }).success,
    ).toBe(true);
  });

  it("AuthTokenPayloadSchema accepts a valid payload", () => {
    expect(
      AuthTokenPayloadSchema.safeParse({
        sub: "user-1",
        org: "org-1",
        role: "ADMIN",
        iat: 1726800000,
        exp: 1726803600,
      }).success,
    ).toBe(true);
    expect(
      AuthTokenPayloadSchema.safeParse({
        sub: "user-1",
        org: "org-1",
        role: "SUPERUSER",
        iat: 1726800000,
        exp: 1726803600,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Realtime / Automation
// ---------------------------------------------------------------------------

describe("RealtimeEventSchema", () => {
  it("accepts device-scoped and project-scoped events", () => {
    expect(
      RealtimeEventSchema.safeParse({
        kind: "device.telemetry",
        projectId: "proj1",
        deviceId: "DEV-ABCDE",
        at: 1726800000000,
        data: { temperature: 23.5 },
      }).success,
    ).toBe(true);
    expect(
      RealtimeEventSchema.safeParse({
        kind: "automation.triggered",
        projectId: "proj1",
        at: 1726800000000,
        data: {},
      }).success,
    ).toBe(true);
  });

  it("rejects unknown event kinds", () => {
    expect(
      RealtimeEventSchema.safeParse({
        kind: "device.exploded",
        projectId: "proj1",
        at: 1726800000000,
        data: {},
      }).success,
    ).toBe(false);
  });
});

describe("AutomationSchema", () => {
  const valid = {
    projectId: "proj1",
    name: "Cool when hot",
    condition: { capabilityId: "temperature", operator: ">", value: 30 },
    action: { capabilityId: "mode", action: "set", params: { value: "cool" } },
  };

  it("accepts a valid automation and defaults enabled/action", () => {
    const parsed = AutomationSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.enabled).toBe(true);
      expect(parsed.data.action.action).toBe("set");
    }
  });

  it("rejects invalid operators", () => {
    expect(
      AutomationSchema.safeParse({
        ...valid,
        condition: { ...valid.condition, operator: "===" },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validate.ts
// ---------------------------------------------------------------------------

describe("validateCapabilityValue", () => {
  const intCap: Capability = {
    id: "brightness",
    name: "Brightness",
    type: "integer",
    kind: "actuator",
    min: 0,
    max: 100,
  };
  const boolCap: Capability = {
    id: "power",
    name: "Power",
    type: "boolean",
    kind: "actuator",
  };
  const strCap: Capability = {
    id: "label",
    name: "Label",
    type: "string",
    kind: "status",
  };

  it("accepts in-range values", () => {
    expect(validateCapabilityValue(numberCapability, 23.5)).toEqual({
      ok: true,
    });
    expect(validateCapabilityValue(intCap, 50)).toEqual({ ok: true });
    expect(validateCapabilityValue(boolCap, true)).toEqual({ ok: true });
    expect(validateCapabilityValue(strCap, "hello")).toEqual({ ok: true });
    expect(validateCapabilityValue(enumCapability, "cool")).toEqual({
      ok: true,
    });
  });

  it("rejects out-of-range numbers", () => {
    expect(validateCapabilityValue(numberCapability, -50).ok).toBe(false);
    expect(validateCapabilityValue(numberCapability, 100).ok).toBe(false);
    expect(validateCapabilityValue(intCap, 101).ok).toBe(false);
    // boundary values are accepted
    expect(validateCapabilityValue(numberCapability, -40).ok).toBe(true);
    expect(validateCapabilityValue(numberCapability, 85).ok).toBe(true);
  });

  it("rejects wrong primitive types", () => {
    expect(validateCapabilityValue(numberCapability, "23").ok).toBe(false);
    expect(validateCapabilityValue(intCap, 1.5).ok).toBe(false);
    expect(validateCapabilityValue(boolCap, 1).ok).toBe(false);
    expect(validateCapabilityValue(strCap, 42).ok).toBe(false);
    expect(validateCapabilityValue(numberCapability, NaN).ok).toBe(false);
    expect(validateCapabilityValue(boolCap, null).ok).toBe(false);
  });

  it("rejects enum values outside the allowed set", () => {
    const result = validateCapabilityValue(enumCapability, "turbo");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("turbo");
  });

  it("returns a reason on failure", () => {
    const result = validateCapabilityValue(numberCapability, "hot");
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// ids.ts
// ---------------------------------------------------------------------------

describe("makeMessageId", () => {
  it("formats deviceId-bootId-padded sequence", () => {
    expect(makeMessageId("DEV-ABCDE", "boot1", 1)).toBe(
      "DEV-ABCDE-boot1-000001",
    );
    expect(makeMessageId("DEV-ABCDE", "boot1", 123456)).toBe(
      "DEV-ABCDE-boot1-123456",
    );
    expect(makeMessageId("DEV-ABCDE", "boot1", 0)).toBe("DEV-ABCDE-boot1-000000");
  });

  it("pads sequences longer than 6 digits without truncation", () => {
    expect(makeMessageId("d", "b", 1234567)).toBe("d-b-1234567");
  });
});
