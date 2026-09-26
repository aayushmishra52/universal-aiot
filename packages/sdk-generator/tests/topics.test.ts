import { describe, expect, it } from "vitest";
import {
  topicManifest,
  topicStatus,
  topicTelemetry,
  topicCommand,
  topicPresence,
  topicHealth,
  topicRoot,
  parseTopic,
  PROTOCOL_VERSION,
} from "@aiot/contracts";

describe("canonical topic builders", () => {
  const org = "org-1";
  const project = "project-1";
  const device = "DEV-9K2QX7";

  it("builds the canonical topic scheme", () => {
    expect(topicRoot(org, project, device)).toBe("aiot/v1/org-1/project-1/DEV-9K2QX7");
    expect(topicManifest(org, project, device)).toBe("aiot/v1/org-1/project-1/DEV-9K2QX7/manifest");
    expect(topicStatus(org, project, device)).toBe("aiot/v1/org-1/project-1/DEV-9K2QX7/status");
    expect(topicTelemetry(org, project, device)).toBe("aiot/v1/org-1/project-1/DEV-9K2QX7/telemetry");
    expect(topicCommand(org, project, device)).toBe("aiot/v1/org-1/project-1/DEV-9K2QX7/command");
    expect(topicPresence(org, project, device)).toBe("aiot/v1/org-1/project-1/DEV-9K2QX7/presence");
    expect(topicHealth(org, project, device)).toBe("aiot/v1/org-1/project-1/DEV-9K2QX7/health");
  });

  it("round-trips through parseTopic", () => {
    const parsed = parseTopic(topicTelemetry(org, project, device));
    expect(parsed).toEqual({ orgId: org, projectId: project, deviceId: device, kind: "telemetry" });
  });

  it("rejects non-canonical topics", () => {
    expect(parseTopic("aiot/v1/org-1/project-1/DEV-9K2QX7/bogus")).toBeNull();
    expect(parseTopic("something/else")).toBeNull();
  });

  it("pins protocol version 1.0", () => {
    expect(PROTOCOL_VERSION).toBe("1.0");
  });
});
