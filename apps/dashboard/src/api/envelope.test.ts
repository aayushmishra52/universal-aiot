/**
 * Regression tests for the `projects.map is not a function` crash.
 *
 * Backend list endpoints return envelope objects ({orgs:[...]}, {projects:[...]},
 * {devices:[...]}, ...) but the dashboard client used to hand the raw parsed JSON
 * back to callers, so pages calling `.map()` on the result crashed. These tests
 * mock global fetch with real envelope payloads (matching the backend route shapes)
 * and assert every list/create/update helper returns the unwrapped value.
 *
 * On the old code shape (returning `request(...)` directly) these tests FAIL:
 * e.g. listProjects() would return {projects:[...]} which is not an array.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE,
  createAutomation,
  createDevice,
  createOrg,
  createProject,
  getTelemetry,
  listAutomations,
  listCommands,
  listDevices,
  listOrgs,
  listProjects,
  sendCommand,
  setToken,
  updateAutomation,
} from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stub fetch with a single canned JSON body; returns the mock for URL inspection. */
function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => jsonResponse(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const [url] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as unknown as [
    string,
    RequestInit,
  ];
  return url;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe("envelope unwrapping (regression: *.map is not a function)", () => {
  it("API_BASE has no /api suffix, so request URLs never become /api/api/...", () => {
    expect(API_BASE).not.toMatch(/\/api\/?$/);
    const fetchMock = stubFetch({ orgs: [] });
    return listOrgs().then(() => {
      const url = lastUrl(fetchMock);
      expect(url).toBe(`${API_BASE}/api/orgs`);
      expect(url).not.toContain("/api/api");
    });
  });

  it("listOrgs unwraps {orgs:[...]} into an array", async () => {
    stubFetch({ orgs: [{ id: "org-1", name: "Acme" }] });
    const orgs = await listOrgs();
    expect(Array.isArray(orgs)).toBe(true);
    expect(orgs.map((o) => o.id)).toEqual(["org-1"]);
  });

  it("createOrg unwraps {org:{...}}", async () => {
    stubFetch({ org: { id: "org-9", name: "New Co" } });
    const org = await createOrg("New Co");
    expect(org.id).toBe("org-9");
  });

  it("listProjects unwraps {projects:[...]} into an array (the original crash)", async () => {
    stubFetch({ projects: [{ id: "p-1", name: "Greenhouse" }] });
    const projects = await listProjects("org-1");
    expect(Array.isArray(projects)).toBe(true);
    // This is exactly what Layout.tsx does; it crashed with the raw envelope.
    expect(projects.map((p) => p.name)).toEqual(["Greenhouse"]);
  });

  it("createProject unwraps {project:{...}}", async () => {
    stubFetch({ project: { id: "p-2", name: "Barn" } });
    const project = await createProject("org-1", "Barn");
    expect(project.id).toBe("p-2");
  });

  it("listDevices unwraps {devices:[...]} into an array", async () => {
    stubFetch({
      devices: [{ deviceId: "DEV-1", name: "Sensor A", status: "online" }],
    });
    const devices = await listDevices("p-1");
    expect(Array.isArray(devices)).toBe(true);
    expect(devices.map((d) => d.deviceId)).toEqual(["DEV-1"]);
  });

  it("getTelemetry unwraps {telemetry:[...]} into an array", async () => {
    stubFetch({
      telemetry: [{ ts: 1, seq: 1, messageId: "m1", values: { temp: 21.5 } }],
    });
    const points = await getTelemetry("DEV-1", { limit: 10 });
    expect(Array.isArray(points)).toBe(true);
    expect(points.map((p) => p.values.temp)).toEqual([21.5]);
  });

  it("listCommands unwraps {commands:[...]} into an array", async () => {
    stubFetch({
      commands: [
        {
          commandId: "cmd-1",
          capabilityId: "pump",
          action: "set",
          params: { value: true },
          issuedAt: 1000,
          expiresAt: 31000,
          status: "PENDING",
        },
      ],
    });
    const commands = await listCommands("DEV-1");
    expect(Array.isArray(commands)).toBe(true);
    expect(commands.map((c) => c.commandId)).toEqual(["cmd-1"]);
  });

  it("sendCommand unwraps {command:{...}} (matches backend routes/commands.ts)", async () => {
    stubFetch({
      command: {
        commandId: "cmd-7",
        capabilityId: "pump",
        action: "set",
        params: { value: true },
        issuedAt: 1000,
        expiresAt: 31000,
        status: "PENDING",
      },
    });
    const cmd = await sendCommand("DEV-1", {
      capabilityId: "pump",
      params: { value: true },
    });
    expect(cmd.commandId).toBe("cmd-7");
  });

  it("listAutomations unwraps {automations:[...]} into an array", async () => {
    stubFetch({ automations: [{ id: "a-1", name: "Night lights", enabled: true }] });
    const automations = await listAutomations("p-1");
    expect(Array.isArray(automations)).toBe(true);
    expect(automations.map((a) => a.id)).toEqual(["a-1"]);
  });

  it("createAutomation / updateAutomation unwrap {automation:{...}}", async () => {
    stubFetch({ automation: { id: "a-2", name: "Watering", enabled: true } });
    const created = await createAutomation("p-1", {
      name: "Watering",
      enabled: true,
      condition: { capabilityId: "soil", operator: "<", value: 30 },
      action: { capabilityId: "pump", action: "set", params: { value: true } },
    });
    expect(created.id).toBe("a-2");

    stubFetch({ automation: { id: "a-2", name: "Watering+", enabled: false } });
    const updated = await updateAutomation("p-1", "a-2", { enabled: false });
    expect(updated.enabled).toBe(false);
  });

  it("createDevice (pairing bundle) passes through the backend envelope untouched", async () => {
    stubFetch({
      device: { deviceId: "DEV-9", name: "Node", status: "pending" },
      pairing: { deviceId: "DEV-9", username: "pair-user", password: "pair-pass" },
    });
    const bundle = await createDevice("p-1", { name: "Node" });
    expect(bundle.device.deviceId).toBe("DEV-9");
    expect(bundle.pairing.username).toBe("pair-user");
  });
});
