import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  pairDevice,
  sendCommand,
  setToken,
} from "../api/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe("api client", () => {
  it("pair flow: posts credentials and returns the one-time device token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        deviceId: "DEV-ABCDE",
        projectId: "proj-1",
        orgId: "org-1",
        rotated: false,
        deviceToken: "devtok-123",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setToken("user-jwt");

    const res = await pairDevice({
      deviceId: "DEV-ABCDE",
      username: "pair-user",
      password: "pair-pass",
    });

    expect(res.deviceToken).toBe("devtok-123");
    expect(res.deviceId).toBe("DEV-ABCDE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/pair$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      deviceId: "DEV-ABCDE",
      username: "pair-user",
      password: "pair-pass",
    });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer user-jwt");
  });

  it("sends commands with default action 'set'", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        command: {
          commandId: "cmd-1",
          capabilityId: "pump",
          action: "set",
          params: { value: true },
          issuedAt: 1000,
          expiresAt: 31000,
          status: "PENDING",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const cmd = await sendCommand("DEV-ABCDE", {
      capabilityId: "pump",
      params: { value: true },
    });
    expect(cmd.commandId).toBe("cmd-1");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      capabilityId: "pump",
      action: "set",
      params: { value: true },
    });
  });

  it("throws ApiError with status on HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Forbidden" }, 403)));
    await expect(
      sendCommand("DEV-ABCDE", { capabilityId: "pump", params: { value: true } }),
    ).rejects.toMatchObject({ name: "ApiError", status: 403, message: "Forbidden" });
  });

  it("throws ApiError with status 0 on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(
      pairDevice({ deviceId: "DEV-X", username: "u", password: "p" }),
    ).rejects.toMatchObject({ name: "ApiError", status: 0 });
  });
});
