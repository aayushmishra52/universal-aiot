import { createContext, useContext } from "react";
import type { RealtimeEvent } from "@aiot/contracts";

export interface RealtimeContextValue {
  connected: boolean;
  lastEvent: RealtimeEvent | null;
  events: RealtimeEvent[];
  reconnect: () => void;
}

export const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  lastEvent: null,
  events: [],
  reconnect: () => {},
});

export function useRealtimeState(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
