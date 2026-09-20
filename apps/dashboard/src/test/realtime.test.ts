import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRealtime, WS_URL } from "../ws/useRealtime";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

function installMock() {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useRealtime", () => {
  it("connects to WS_URL, authenticates, then subscribes to the project", () => {
    installMock();
    renderHook(() => useRealtime("proj-1", "jwt-token"));

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe(WS_URL);

    act(() => {
      ws.onopen?.();
    });

    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "auth", token: "jwt-token" });
    expect(JSON.parse(ws.sent[1])).toEqual({ type: "subscribe", projectId: "proj-1" });
  });

  it("exposes received realtime events and connection state", () => {
    installMock();
    const { result } = renderHook(() => useRealtime("proj-1", "jwt-token"));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onopen?.();
    });
    expect(result.current.connected).toBe(true);

    const ev = {
      kind: "device.telemetry",
      projectId: "proj-1",
      deviceId: "DEV-ABCDE",
      at: 123456,
      data: { values: { temperature: 21.5 } },
    };
    act(() => {
      ws.onmessage?.({ data: JSON.stringify(ev) });
    });

    expect(result.current.lastEvent).toMatchObject({
      kind: "device.telemetry",
      deviceId: "DEV-ABCDE",
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].data).toEqual({ values: { temperature: 21.5 } });
  });

  it("ignores malformed messages", () => {
    installMock();
    const { result } = renderHook(() => useRealtime("proj-1", "jwt-token"));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onopen?.();
      ws.onmessage?.({ data: "not-json{{{" });
      ws.onmessage?.({ data: JSON.stringify({ nope: true }) });
    });

    expect(result.current.lastEvent).toBeNull();
    expect(result.current.events).toHaveLength(0);
  });

  it("does not connect without projectId or token", () => {
    installMock();
    renderHook(() => useRealtime(null, "jwt-token"));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("marks disconnected and reconnects with backoff after close", () => {
    installMock();
    vi.useFakeTimers();
    const { result } = renderHook(() => useRealtime("proj-1", "jwt-token"));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onopen?.();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      ws.close();
    });
    expect(result.current.connected).toBe(false);

    // backoff timer fires a reconnect
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });
});
