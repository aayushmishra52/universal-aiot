/**
 * Fleet overview — KPIs, telemetry chart, health donut, live events,
 * automations and recent command history.
 *
 * Every number on this page comes from the REST API (client.ts) or the
 * realtime event buffer. Nothing is hardcoded; loading and empty states
 * are shown whenever there is no data.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Automation, Capability } from "@aiot/contracts";
import {
  getDevice,
  getTelemetry,
  listAutomations,
  listCommands,
  listDevices,
  type CommandRecord,
  type DeviceSummary,
  type TelemetryPoint,
} from "../api/client";
import { useSelection } from "../components/Layout";
import { useRealtimeState } from "../ws/RealtimeContext";
import { Chart, Donut } from "../components/Chart";
import {
  EmptyState,
  ErrorBanner,
  Loading,
  fmtTime,
  timeAgo,
} from "../components/common";

interface CommandRow extends CommandRecord {
  deviceId: string;
  deviceName: string;
}

const FAILED_STATUSES = ["FAILED", "EXPIRED", "REJECTED"];
const MAX_RATE_DEVICES = 8;

function statusBucket(status: string): "online" | "offline" | "degraded" | "unknown" {
  const s = (status ?? "").toLowerCase();
  if (s === "online") return "online";
  if (s === "offline") return "offline";
  if (s === "degraded" || s === "error") return "degraded";
  return "unknown";
}

export function OverviewPage() {
  const { projectId, projects, loading: selLoading, error: selError } = useSelection();
  const { events } = useRealtimeState();

  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [msgsPerMin, setMsgsPerMin] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // telemetry chart selection
  const [chartDeviceId, setChartDeviceId] = useState("");
  const [metric, setMetric] = useState("");
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [telemetryLoading, setTelemetryLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setDevices([]);
      setAutomations([]);
      setCommands([]);
      setMsgsPerMin(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [devs, autos] = await Promise.all([
        listDevices(projectId),
        listAutomations(projectId),
      ]);
      setDevices(devs);
      setAutomations(autos);
      setChartDeviceId((prev) => (prev === "" && devs.length > 0 ? devs[0].deviceId : prev));

      // Recent command history across devices (API-backed).
      const cmdLists = await Promise.all(
        devs.slice(0, 12).map((d) =>
          listCommands(d.deviceId, 20)
            .then((cmds): CommandRow[] =>
              cmds.map((c) => ({ ...c, deviceId: d.deviceId, deviceName: d.name })),
            )
            .catch((): CommandRow[] => []),
        ),
      );
      const all = cmdLists.flat().sort((a, b) => b.issuedAt - a.issuedAt);
      setCommands(all);

      // Msgs/min sampled from recent telemetry on the most recently
      // seen devices (there is no fleet-rate endpoint; label says so).
      const sampled = [...devs]
        .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
        .slice(0, MAX_RATE_DEVICES);
      const telLists = await Promise.all(
        sampled.map((d) => getTelemetry(d.deviceId, { limit: 60 }).catch((): TelemetryPoint[] => [])),
      );
      const cutoff = Date.now() - 60_000;
      setMsgsPerMin(telLists.flat().filter((p) => p.ts >= cutoff).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Telemetry + capabilities for the selected chart device.
  useEffect(() => {
    if (!chartDeviceId) {
      setTelemetry([]);
      setCapabilities([]);
      return;
    }
    let cancelled = false;
    setTelemetryLoading(true);
    (async () => {
      try {
        const pts = await getTelemetry(chartDeviceId, { limit: 150 });
        if (!cancelled) setTelemetry(pts);
        const detail = await getDevice(chartDeviceId).catch(() => null);
        if (!cancelled) setCapabilities(detail?.capabilities ?? []);
      } catch {
        if (!cancelled) {
          setTelemetry([]);
          setCapabilities([]);
        }
      } finally {
        if (!cancelled) setTelemetryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chartDeviceId]);

  // Merge realtime presence into device statuses (same as DevicesPage).
  const liveDevices = useMemo(() => {
    const presence = new Map<string, "online" | "offline">();
    for (const ev of events) {
      if (!ev.deviceId) continue;
      if (ev.kind === "device.online") presence.set(ev.deviceId, "online");
      else if (ev.kind === "device.offline") presence.set(ev.deviceId, "offline");
    }
    if (presence.size === 0) return devices;
    return devices.map((d) => {
      const p = presence.get(d.deviceId);
      return p ? { ...d, status: p } : d;
    });
  }, [devices, events]);

  const onlineCount = liveDevices.filter((d) => d.status === "online").length;
  const alerts = commands.filter((c) => FAILED_STATUSES.includes(c.status.toUpperCase())).length;
  const enabledAutomations = automations.filter((a) => a.enabled).length;

  const donutSegments = useMemo(
    () => [
      {
        value: liveDevices.filter((d) => statusBucket(d.status) === "online").length,
        color: "var(--green)",
        label: "Online",
      },
      {
        value: liveDevices.filter((d) => statusBucket(d.status) === "offline").length,
        color: "var(--red)",
        label: "Offline",
      },
      {
        value: liveDevices.filter((d) => statusBucket(d.status) === "degraded").length,
        color: "var(--amber)",
        label: "Degraded",
      },
      {
        value: liveDevices.filter((d) => statusBucket(d.status) === "unknown").length,
        color: "var(--text-faint)",
        label: "Unknown",
      },
    ],
    [liveDevices],
  );

  const numericMetrics = useMemo(() => {
    const keys = new Set<string>();
    for (const p of telemetry) {
      for (const [k, v] of Object.entries(p.values ?? {})) {
        if (typeof v === "number" && Number.isFinite(v)) keys.add(k);
      }
    }
    return [...keys].sort();
  }, [telemetry]);

  useEffect(() => {
    if (numericMetrics.length > 0 && !numericMetrics.includes(metric)) {
      setMetric(numericMetrics[0]);
    }
  }, [numericMetrics, metric]);

  const series = useMemo(
    () =>
      metric
        ? telemetry
            .filter((p) => typeof p.values?.[metric] === "number")
            .map((p) => ({ ts: p.ts, value: p.values[metric] as number }))
        : [],
    [telemetry, metric],
  );
  const metricUnit = capabilities.find((c) => c.id === metric)?.unit;

  const recentEvents = useMemo(
    () =>
      events
        .filter((e) =>
          [
            "device.telemetry",
            "device.online",
            "device.offline",
            "command.created",
            "command.failed",
            "automation.triggered",
          ].includes(e.kind),
        )
        .slice(0, 14),
    [events],
  );

  const recentCommands = commands.slice(0, 12);
  const projectName = projects.find((p) => p.id === projectId)?.name;

  if (selLoading) {
    return (
      <div className="page">
        <Loading label="Loading workspace…" />
      </div>
    );
  }
  if (selError) {
    return (
      <div className="page">
        <ErrorBanner message={selError} />
      </div>
    );
  }
  if (!projectId) {
    return (
      <div className="page">
        <EmptyState
          icon="◈"
          title="No project selected"
          body="Select or create a project from the top bar to see its fleet overview."
          action={
            <Link to="/devices" className="btn btn-primary" style={{ textDecoration: "none" }}>
              Go to devices
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">
            {projectName} · fleet at a glance
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
          ⟳ Refresh
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} onRetry={() => void load()} />
        </div>
      )}

      {loading ? (
        <>
          <div className="ov-kpis" style={{ marginBottom: 22 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="stat">
                <div className="skeleton" style={{ height: 64 }} />
              </div>
            ))}
          </div>
          <div className="card">
            <Loading label="Loading overview…" />
          </div>
        </>
      ) : devices.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="📡"
            title="No devices yet"
            body="Add your first device and the fleet KPIs, health chart and telemetry will appear here."
            action={
              <Link to="/devices/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
                + Add device
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="ov-kpis" style={{ marginBottom: 22 }}>
            <div className="stat" data-testid="kpi-total">
              <div className="stat-label">Total devices</div>
              <div className="stat-value">{devices.length}</div>
              <div className="kpi-sub">in {projectName}</div>
            </div>
            <div className="stat" data-testid="kpi-online">
              <div className="stat-label">Online now</div>
              <div className={`stat-value ${onlineCount > 0 ? "ok" : ""}`}>{onlineCount}</div>
              <div className="kpi-sub">from device status + realtime presence</div>
            </div>
            <div className="stat" data-testid="kpi-rate">
              <div className="stat-label">Telemetry rate</div>
              <div className="stat-value">{msgsPerMin === null ? "—" : msgsPerMin}</div>
              <div className="kpi-sub">msgs/min · sampled, last 60s</div>
            </div>
            <div className="stat" data-testid="kpi-alerts">
              <div className="stat-label">Command alerts</div>
              <div className={`stat-value ${alerts > 0 ? "warn" : ""}`}>{alerts}</div>
              <div className="kpi-sub">failed · expired · rejected</div>
            </div>
            <div className="stat" data-testid="kpi-automations">
              <div className="stat-label">Automations active</div>
              <div className={`stat-value ${enabledAutomations > 0 ? "ok" : ""}`}>
                {enabledAutomations}
              </div>
              <div className="kpi-sub">{automations.length} rule{automations.length === 1 ? "" : "s"} total</div>
            </div>
          </div>

          <div className="ov-grid">
            <div className="card">
              <h3 className="card-title">Telemetry</h3>
              <div className="picker-row">
                <select
                  className="input select-inline"
                  aria-label="Chart device"
                  value={chartDeviceId}
                  onChange={(e) => {
                    setChartDeviceId(e.target.value);
                    setMetric("");
                  }}
                >
                  {liveDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input select-inline"
                  aria-label="Chart metric"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  disabled={numericMetrics.length === 0}
                >
                  {numericMetrics.length === 0 && <option value="">No numeric metrics</option>}
                  {numericMetrics.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  last {telemetry.length} points
                </span>
              </div>
              {telemetryLoading ? (
                <div className="skeleton" style={{ height: 180 }} />
              ) : (
                <Chart series={series} unit={metricUnit} height={180} />
              )}
            </div>

            <div className="card">
              <h3 className="card-title">Device health</h3>
              <div className="donut-wrap">
                <Donut
                  segments={donutSegments}
                  centerTop={String(liveDevices.length)}
                  centerBottom="devices"
                  emptyLabel="No devices"
                />
                <div className="legend">
                  {donutSegments.map((s) => (
                    <div className="legend-item" key={s.label}>
                      <span className="legend-swatch" style={{ background: s.color }} />
                      {s.label}
                      <span className="legend-val">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-faint)" }}>
                From device status, updated by realtime presence.
              </div>
            </div>
          </div>

          <div className="ov-grid">
            <div className="card">
              <div className="card-head-row">
                <h3 className="card-title" style={{ margin: 0 }}>
                  Recent events
                </h3>
                <Link to="/devices" className="btn btn-ghost btn-sm">
                  View devices →
                </Link>
              </div>
              {recentEvents.length === 0 ? (
                <EmptyState
                  icon="📡"
                  title="No events yet"
                  body="Live events appear here once devices connect and the realtime channel is up."
                />
              ) : (
                <div className="feed">
                  {recentEvents.map((e, i) => (
                    <div className="feed-item" key={`${e.at}-${e.kind}-${i}`}>
                      <EventIcon kind={e.kind} />
                      <span style={{ color: "var(--text-dim)" }}>
                        <EventText event={e} devices={liveDevices} />
                      </span>
                      <span className="fi-time">{fmtTime(e.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head-row">
                <h3 className="card-title" style={{ margin: 0 }}>
                  Automations
                </h3>
                <Link to="/automations" className="btn btn-ghost btn-sm">
                  Manage →
                </Link>
              </div>
              {automations.length === 0 ? (
                <EmptyState
                  icon="⚡"
                  title="No automation rules"
                  body="Create rules to react to sensor readings automatically."
                  action={
                    <Link to="/automations" className="btn btn-primary btn-sm" style={{ textDecoration: "none" }}>
                      Open automations
                    </Link>
                  }
                />
              ) : (
                <div className="feed">
                  {automations.map((a) => (
                    <div className="feed-item" key={a.id ?? a.name}>
                      <span
                        className={`pill ${a.enabled ? "online" : "neutral"}`}
                        style={{ fontSize: 10.5 }}
                      >
                        {a.enabled ? "ON" : "OFF"}
                      </span>
                      <span style={{ color: "var(--text-dim)" }}>
                        <strong style={{ color: "var(--text)" }}>{a.name}</strong>
                        <br />
                        <span className="mono" style={{ fontSize: 11.5 }}>
                          {a.condition.capabilityId} {a.condition.operator}{" "}
                          {String(a.condition.value)} → {a.action.capabilityId}.
                          {a.action.action}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head-row">
              <h3 className="card-title" style={{ margin: 0 }}>
                Recent commands
              </h3>
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                across {Math.min(devices.length, 12)} devices
              </span>
            </div>
            {recentCommands.length === 0 ? (
              <EmptyState
                icon="📤"
                title="No commands issued"
                body="Commands sent to devices will show up here with their delivery status."
              />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Device</th>
                      <th>Capability</th>
                      <th>Action</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentCommands.map((c) => (
                      <tr key={`${c.deviceId}-${c.commandId}`}>
                        <td title={fmtTime(c.issuedAt)} style={{ whiteSpace: "nowrap" }}>
                          {timeAgo(c.issuedAt)}
                        </td>
                        <td>
                          <Link to={`/devices/${c.deviceId}`} className="mono">
                            {c.deviceName}
                          </Link>
                        </td>
                        <td className="mono">{c.capabilityId}</td>
                        <td className="mono">{c.action}</td>
                        <td>
                          <span className={`cmd-status ${c.status.toUpperCase()}`}>
                            {c.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EventIcon({ kind }: { kind: string }) {
  const icon =
    kind === "device.online"
      ? "🟢"
      : kind === "device.offline"
        ? "🔴"
        : kind === "device.telemetry"
          ? "📈"
          : kind === "command.created"
            ? "📤"
            : kind === "command.failed"
              ? "⚠️"
              : "⚡";
  return <span>{icon}</span>;
}

function EventText({
  event,
  devices,
}: {
  event: { kind: string; deviceId?: string; data: Record<string, unknown> };
  devices: DeviceSummary[];
}) {
  const name =
    devices.find((d) => d.deviceId === event.deviceId)?.name ??
    (event.deviceId ? <span className="mono">{event.deviceId}</span> : "project");
  switch (event.kind) {
    case "device.online":
      return <>{name} came online</>;
    case "device.offline":
      return <>{name} went offline</>;
    case "device.telemetry": {
      const keys = Object.keys((event.data.values as Record<string, unknown> | undefined) ?? {});
      return (
        <>
          {name} telemetry: {keys.slice(0, 3).join(", ")}
          {keys.length > 3 ? "…" : ""}
        </>
      );
    }
    case "command.created":
      return (
        <>
          Command <span className="mono">{(event.data.commandId as string) ?? ""}</span> issued
          to {name}
        </>
      );
    case "command.failed":
      return (
        <>
          Command <span className="mono">{(event.data.commandId as string) ?? ""}</span> failed
          on {name}
        </>
      );
    case "automation.triggered":
      return (
        <>
          Automation{" "}
          <span className="mono">
            {(event.data.automationId as string) ?? (event.data.name as string) ?? ""}
          </span>{" "}
          triggered
        </>
      );
    default:
      return (
        <>
          {event.kind} — {name}
        </>
      );
  }
}
