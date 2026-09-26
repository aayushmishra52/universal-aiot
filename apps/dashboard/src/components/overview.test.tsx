import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Automation, RealtimeEvent } from "@aiot/contracts";
import {
  listAutomations,
  listCommands,
  listDevices,
  getDevice,
  getTelemetry,
  type CommandRecord,
  type DeviceSummary,
  type TelemetryPoint,
} from "../api/client";
import { OverviewPage } from "../pages/OverviewPage";

vi.mock("../api/client", () => ({
  listDevices: vi.fn(),
  listAutomations: vi.fn(),
  listCommands: vi.fn(),
  getDevice: vi.fn(),
  getTelemetry: vi.fn(),
}));

vi.mock("./Layout", () => ({
  useSelection: () => ({
    projectId: "p1",
    projects: [{ id: "p1", name: "Greenhouse" }],
    loading: false,
    error: null,
  }),
}));

const demoEvents: RealtimeEvent[] = [
  { kind: "device.online", projectId: "p1", deviceId: "dev-1", at: Date.now() - 1000, data: {} },
  {
    kind: "command.failed",
    projectId: "p1",
    deviceId: "dev-2",
    at: Date.now() - 2000,
    data: { commandId: "c2" },
  },
  {
    kind: "automation.triggered",
    projectId: "p1",
    at: Date.now() - 3000,
    data: { automationId: "auto-1" },
  },
];

vi.mock("../ws/RealtimeContext", () => ({
  useRealtimeState: () => ({ connected: true, lastEvent: null, events: demoEvents }),
}));

const now = Date.now();

function fullPayloads() {
  const devices: DeviceSummary[] = [
    { deviceId: "dev-1", name: "Greenhouse Node", status: "online", lastSeen: now - 10_000, capabilityCount: 4 },
    { deviceId: "dev-2", name: "Pump Controller", status: "online", lastSeen: now - 20_000, capabilityCount: 2 },
    { deviceId: "dev-3", name: "Old Sensor", status: "offline", lastSeen: now - 3_600_000, capabilityCount: 1 },
  ];
  const automations: Automation[] = [
    {
      id: "auto-1",
      projectId: "p1",
      name: "Heat alert",
      enabled: true,
      condition: { capabilityId: "temperature", operator: ">", value: 30 },
      action: { capabilityId: "fan", action: "set", params: { value: true } },
    },
    {
      id: "auto-2",
      projectId: "p1",
      name: "Night lights",
      enabled: false,
      condition: { capabilityId: "lux", operator: "<", value: 50 },
      action: { capabilityId: "lamp", action: "set", params: { value: true } },
    },
  ];
  const commands: CommandRecord[] = [
    {
      commandId: "c1",
      capabilityId: "fan",
      action: "set",
      params: { value: true },
      issuedAt: now - 5_000,
      expiresAt: now + 55_000,
      status: "SUCCEEDED",
    },
    {
      commandId: "c2",
      capabilityId: "pump",
      action: "set",
      params: { value: true },
      issuedAt: now - 60_000,
      expiresAt: now,
      status: "FAILED",
    },
  ];
  // 10 points, 5s apart — all safely inside the 60s rate window.
  const telemetry: TelemetryPoint[] = Array.from({ length: 10 }, (_, i) => ({
    ts: now - (9 - i) * 5_000,
    seq: i,
    messageId: `m${i}`,
    values: { temperature: 20 + i, humidity: 50 + i },
  }));

  vi.mocked(listDevices).mockResolvedValue(devices);
  vi.mocked(listAutomations).mockResolvedValue(automations);
  // Only dev-1 has command history; the others return none (mirrors the real API).
  vi.mocked(listCommands).mockImplementation((deviceId) =>
    Promise.resolve(deviceId === "dev-1" ? commands : []),
  );
  vi.mocked(getTelemetry).mockResolvedValue(telemetry);
  vi.mocked(getDevice).mockResolvedValue({
    device: devices[0],
    capabilities: [
      { id: "temperature", name: "Temperature", type: "number", kind: "sensor", unit: "°C" },
      { id: "humidity", name: "Humidity", type: "number", kind: "sensor", unit: "%" },
    ],
    state: { desired: {}, reported: {} },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>,
  );
}

describe("OverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fullPayloads();
  });

  it("shows a loading state while the API calls are in flight", () => {
    renderPage();
    expect(screen.getByText("Loading overview…")).toBeInTheDocument();
  });

  it("renders KPI values computed from real API payloads", async () => {
    renderPage();
    expect(await screen.findByTestId("kpi-total")).toHaveTextContent("3");
    expect(within(screen.getByTestId("kpi-online")).getByText("2")).toBeInTheDocument();
    // 3 sampled devices × 10 telemetry points inside the 60s window
    expect(within(screen.getByTestId("kpi-rate")).getByText("30")).toBeInTheDocument();
    // one FAILED command (only dev-1 has command history in the mock)
    expect(within(screen.getByTestId("kpi-alerts")).getByText("1")).toBeInTheDocument();
    // one enabled automation
    expect(within(screen.getByTestId("kpi-automations")).getByText("1")).toBeInTheDocument();
  });

  it("renders donut and telemetry charts as non-empty SVG", async () => {
    renderPage();
    // Wait until the async telemetry fetch for the chart device has landed…
    await screen.findByText("last 10 points");
    // …and the auto-selected metric has produced a series.
    await screen.findByRole("img", { name: /Time series chart/ });
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    for (const svg of svgs) {
      expect(svg.innerHTML).toMatch(/path|circle/);
    }
  });

  it("renders automations, recent events and command history", async () => {
    renderPage();
    await screen.findByText("Heat alert");
    expect(screen.getByText("Night lights")).toBeInTheDocument();
    // event feed entries from the realtime buffer
    expect(screen.getByText(/came online/)).toBeInTheDocument();
    expect(screen.getByText(/triggered/)).toBeInTheDocument();
    // command history row with the FAILED status
    expect(screen.getByText("FAILED")).toBeInTheDocument();
    expect(screen.getByText("pump")).toBeInTheDocument();
  });

  it("renders an empty state when the fleet has no devices", async () => {
    vi.mocked(listDevices).mockResolvedValue([]);
    vi.mocked(listAutomations).mockResolvedValue([]);
    vi.mocked(listCommands).mockResolvedValue([]);
    vi.mocked(getTelemetry).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No devices yet")).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-total")).not.toBeInTheDocument();
  });

  it("renders an empty state for automations and commands when those are empty", async () => {
    vi.mocked(listAutomations).mockResolvedValue([]);
    vi.mocked(listCommands).mockResolvedValue([]);
    renderPage();
    await screen.findByTestId("kpi-total");
    expect(await screen.findByText("No automation rules")).toBeInTheDocument();
    expect(screen.getByText("No commands issued")).toBeInTheDocument();
  });
});
