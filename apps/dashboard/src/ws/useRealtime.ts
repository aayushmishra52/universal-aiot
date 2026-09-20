/**
 * useRealtime — subscribes to the backend realtime WebSocket for a project.
 *
 * Protocol (see @aiot/contracts realtime.ts):
 *   client -> { type: "auth", token }
 *   client -> { type: "subscribe", projectId }
 *   server -> { kind, projectId, deviceId?, at, data }
 *
 * Auto-reconnects with exponential backoff. Keeps the most recent event and
 * a short ring-buffer of recent events for feeds.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@aiot/contracts";

export const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4001";

const MAX_BUFFER = 200;

interface RealtimeState {
  connected: boolean;
  lastEvent: RealtimeEvent | null;
  events: RealtimeEvent[];
  /** Manually force a reconnect. */
  reconnect: () => void;
}

function parseEvent(raw: string): RealtimeEvent | null {
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown };
    if (typeof parsed.kind !== "string") return null;
    return parsed as RealtimeEvent;
  } catch {
    return null;
  }
}

export function useRealtime(projectId: string | null, token: string | null): RealtimeState {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const intentionalClose = useRef(false);
  const stateRef = useRef({ projectId, token });
  stateRef.current = { projectId, token };

  const pushEvent = useCallback((ev: RealtimeEvent) => {
    setLastEvent(ev);
    setEvents((prev) => [ev, ...prev].slice(0, MAX_BUFFER));
  }, []);

  const connect = useCallback(() => {
    const { projectId: pid, token: tok } = stateRef.current;
    if (!pid || !tok) return;

    intentionalClose.current = false;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setConnected(true);
      ws.send(JSON.stringify({ type: "auth", token: tok }));
      ws.send(JSON.stringify({ type: "subscribe", projectId: pid }));
    };
    ws.onmessage = (msg) => {
      const ev = parseEvent(String(msg.data));
      if (ev) pushEvent(ev);
    };
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (intentionalClose.current) return;
      const backoff = Math.min(1000 * 2 ** attemptRef.current, 15000);
      attemptRef.current += 1;
      retryTimer.current = window.setTimeout(connect, backoff);
    };
    ws.onerror = () => {
      ws.close();
    };
  }, [pushEvent]);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    intentionalClose.current = true;
    wsRef.current?.close();
    window.setTimeout(connect, 0);
  }, [connect]);

  useEffect(() => {
    if (!projectId || !token) {
      intentionalClose.current = true;
      wsRef.current?.close();
      setConnected(false);
      return;
    }
    connect();
    return () => {
      intentionalClose.current = true;
      wsRef.current?.close();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [projectId, token, connect]);

  return { connected, lastEvent, events, reconnect };
}
