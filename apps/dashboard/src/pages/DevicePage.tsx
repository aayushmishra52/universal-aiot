import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Capability } from "@aiot/contracts";
import {
  ApiError,
  deleteDevice,
  getDevice,
  getTelemetry,
  listAutomations,
  listCommands,
  rotateCredentials,
  sendCommand,
  type Automation,
  type CommandRecord,
  type DeviceDetail,
  type DeviceState,
  type Health,
  type TelemetryPoint,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSelection } from "../components/Layout";
import { useRealtimeState } from "../ws/RealtimeContext";
import { Chart } from "../components/Chart";
import { CapabilityWidget, type TelemetryValue } from "../components/widgets";
import {
  CopyButton,
  EmptyState,
  ErrorBanner,
  Loading,
  StatusPill,
  fmtTime,
  timeAgo,
} from "../components/common";

type Tab = "overview" | "telemetry" | "controls" | "health" | "events" | "automations" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "telemetry", label: "Telemetry" },
  { id: "controls", label: "Controls" },
  { id: "health", label: "Health" },
  { id: "events", label: "Events" },
  { id: "automations", label: "Automations" },
  { id: "settings", label: "Settings" },
];

const TERMINAL = ["SUCCEEDED", "FAILED", "EXPIRED", "REJECTED", "DUPLICATE"];

export function DevicePage() {
  const { deviceId = "" } = useParams();
  const navigate = useNavigate();
  const { roleFor } = useAuth();
  const { orgId, projectId } = useSelection();
  const { events } = useRealtimeState();

  const role = roleFor(orgId);
  const canControl = role !== "VIEWER";
  const canAdmin = role === "OWNER" || role === "ADMIN";

  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<Record<string, { ts: number; value: number }[]>>({});
  const [latest, setLatest] = useState<Record<string, TelemetryValue>>({});
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [busyCap, setBusyCap] = useState<string | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const seenEvents = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, tele, cmds] = await Promise.all([
        getDevice(deviceId),
        getTelemetry(deviceId, { limit: 200 }).catch(() => [] as TelemetryPoint[]),
        listCommands(deviceId, 50).catch(() => [] as CommandRecord[]),
      ]);
      setDetail(d);
      setCommands(cmds);

      const byCap: Record<string, { ts: number; value: number }[]> = {};
      const vals: Record<string, TelemetryValue> = {};
      for (const pt of tele) {
        for (const [capId, v] of Object.entries(pt.values)) {
          vals[capId] = v as TelemetryValue;
          if (typeof v === "number") {
            (byCap[capId] ||= []).push({ ts: pt.ts, value: v });
          }
        }
      }
      for (const k of Object.keys(byCap)) byCap[k].sort((a, b) => a.ts - b.ts);
      setTelemetry(byCap);
      setLatest((prev) => ({ ...prev, ...vals }));
      // seed from reported state
      setLatest((prev) => ({ ...(d.state?.reported ?? {}), ...prev } as Record<string, TelemetryValue>));

      if (projectId) {
        listAutomations(projectId)
          .then((all) => setAutomations(all.filter((a) => !a.deviceId || a.deviceId === deviceId)))
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load device");
    } finally {
      setLoading(false);
    }
  }, [deviceId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Apply realtime events for this device
  useEffect(() => {
    seenEvents.current = 0; // fresh device → reprocess the shared buffer
  }, [deviceId]);
  useEffect(() => {
    const freshCount = Math.max(0, events.length - seenEvents.current);
    if (freshCount === 0) return;
    const fresh = events.slice(0, freshCount);
    seenEvents.current = events.length;
    for (const ev of fresh.reverse()) {
      if (ev.deviceId !== deviceId) continue;
      switch (ev.kind) {
        case "device.online":
          setDetail((d) => (d ? { ...d, device: { ...d.device, status: "online" } } : d));
          break;
        case "device.offline":
          setDetail((d) => (d ? { ...d, device: { ...d.device, status: "offline" } } : d));
          break;
        case "device.telemetry": {
          const values = (ev.data.values as Record<string, TelemetryValue>) ?? {};
          setLatest((prev) => ({ ...prev, ...values }));
          setTelemetry((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(values)) {
              if (typeof v === "number") {
                next[k] = [...(next[k] ?? []), { ts: ev.at, value: v }].slice(-300);
              }
            }
            return next;
          });
          break;
        }
        case "device.state_changed": {
          const state = ev.data as unknown as Partial<DeviceState>;
          setDetail((d) => (d && state ? { ...d, state: { desired: state.desired ?? d.state.desired, reported: state.reported ?? d.state.reported } } : d));
          if (state?.reported) setLatest((prev) => ({ ...prev, ...(state.reported as Record<string, TelemetryValue>) }));
          break;
        }
        case "device.health":
          setDetail((d) => (d ? { ...d, health: ev.data as unknown as Health } : d));
          break;
        case "command.created":
          setCommands((prev) => [
            {
              commandId: String(ev.data.commandId ?? ""),
              capabilityId: String(ev.data.capabilityId ?? ""),
              action: String(ev.data.action ?? "set"),
              params: (ev.data.params as Record<string, unknown>) ?? {},
              issuedAt: ev.at,
              expiresAt: Number(ev.data.expiresAt ?? ev.at + 30000),
              status: "PENDING",
            },
            ...prev,
          ]);
          break;
        case "command.acknowledged":
        case "command.failed":
          setCommands((prev) =>
            prev.map((c) =>
              c.commandId === ev.data.commandId
                ? { ...c, status: String(ev.data.status ?? (ev.kind === "command.failed" ? "FAILED" : "ACKNOWLEDGED")) }
                : c,
            ),
          );
          break;
        default:
          break;
      }
    }
  }, [events, deviceId]);

  const issueCommand = useCallback(
    async (capabilityId: string, action: string, params: Record<string, unknown>) => {
      setCmdError(null);
      setBusyCap(capabilityId);
      try {
        const cmd = await sendCommand(deviceId, { capabilityId, action, params, ttlMs: 30000 });
        setCommands((prev) => [cmd, ...prev.filter((c) => c.commandId !== cmd.commandId)]);
      } catch (e) {
        setCmdError(e instanceof ApiError ? e.message : "Command failed");
      } finally {
        setBusyCap(null);
      }
    },
    [deviceId],
  );

  const rotate = async () => {
    if (!window.confirm("Rotate device credentials? The old token will stop working immediately.")) return;
    try {
      const res = await rotateCredentials(deviceId);
      setRotatedToken(res.deviceToken);
    } catch (e) {
      setCmdError(e instanceof ApiError ? e.message : "Rotation failed");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete device ${deviceId}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteDevice(deviceId);
      navigate("/");
    } catch (e) {
      setCmdError(e instanceof ApiError ? e.message : "Delete failed");
      setDeleting(false);
    }
  };

  const capabilities = useMemo(() => detail?.capabilities ?? [], [detail]);
  const sensors = useMemo(
    () => capabilities.filter((c) => c.kind !== "actuator"),
    [capabilities],
  );
  const actuators = useMemo(
    () => capabilities.filter((c) => c.kind === "actuator" && c.readOnly !== true),
    [capabilities],
  );
  const numericCaps = useMemo(
    () => capabilities.filter((c) => c.type === "number" || c.type === "integer"),
    [capabilities],
  );

  if (loading) {
    return (
      <div className="page">
        <Loading label="Loading device…" />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="page">
        <ErrorBanner message={error ?? "Device not found"} onRetry={load} />
        <div style={{ marginTop: 16 }}>
          <Link to="/" className="btn">← Back to fleet</Link>
        </div>
      </div>
    );
  }

  const dev = detail.device;
  const health = detail.health;

  return (
    <div className="page">
      <div className="device-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1>{dev.name}</h1>
            <StatusPill status={dev.status} />
          </div>
          <div className="dh-id">{dev.deviceId}</div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12.5, color: "var(--text-dim)", flexWrap: "wrap" }}>
            {dev.model && <span>▦ {dev.model}</span>}
            {dev.firmwareVersion && <span>Firmware v{dev.firmwareVersion}</span>}
            {dev.type && <span className="badge">{dev.type}</span>}
            <span title={fmtTime(dev.lastSeen)}>Last seen {timeAgo(dev.lastSeen)}</span>
          </div>
        </div>
        <div className="dh-actions">
          {!canControl && <span className="pill neutral">View-only</span>}
          <Link to="/" className="btn btn-ghost btn-sm">← Fleet</Link>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "controls" && commands.some((c) => !TERMINAL.includes(c.status.toUpperCase())) && (
              <span className="dot" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--amber)", marginLeft: 7 }} />
            )}
          </button>
        ))}
      </div>

      {cmdError && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={cmdError} />
        </div>
      )}

      {tab === "overview" && (
        <OverviewTab
          capabilities={capabilities}
          latest={latest}
          telemetry={telemetry}
          onCommand={issueCommand}
          canControl={canControl}
          busyCap={busyCap}
        />
      )}

      {tab === "telemetry" && (
        <div className="grid grid-2">
          {numericCaps.length === 0 && (
            <div className="card">
              <EmptyState icon="📈" title="No numeric capabilities" body="This device exposes no number or integer capabilities to chart." />
            </div>
          )}
          {numericCaps.map((cap) => (
            <div className="card" key={cap.id}>
              <h3 className="card-title">{cap.name}{cap.unit ? ` (${cap.unit})` : ""}</h3>
              <Chart series={telemetry[cap.id] ?? []} unit={cap.unit} height={150} />
              <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>
                Latest: <strong style={{ color: "var(--text)" }}>{latest[cap.id] !== undefined ? String(latest[cap.id]) : "—"}</strong>
                {" · "}{(telemetry[cap.id] ?? []).length} samples
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "controls" && (
        <ControlsTab
          actuators={actuators}
          latest={latest}
          onCommand={issueCommand}
          canControl={canControl}
          busyCap={busyCap}
          commands={commands}
        />
      )}

      {tab === "health" && <HealthTab health={health ?? null} capabilities={capabilities} />}

      {tab === "events" && (
        <EventsTab deviceId={deviceId} commands={commands} />
      )}

      {tab === "automations" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h3 className="card-title" style={{ margin: 0 }}>Automations targeting this device</h3>
            <Link to="/automations" className="btn btn-sm">Manage all →</Link>
          </div>
          {automations.length === 0 ? (
            <EmptyState icon="⚡" title="No automations" body="Create one from the Automations page, scoped to this device." />
          ) : (
            <div className="feed">
              {automations.map((a) => (
                <div className="feed-item" key={a.id}>
                  <span>{a.enabled ? "🟢" : "⚪"}</span>
                  <span style={{ fontWeight: 650 }}>{a.name}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                    when {a.condition.capabilityId} {a.condition.operator} {String(a.condition.value)}
                    → {a.action.capabilityId}.{a.action.action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div className="grid grid-2">
          <div className="card">
            <h3 className="card-title">Device info</h3>
            <dl className="kv">
              <dt>Device ID</dt><dd className="mono">{dev.deviceId}</dd>
              <dt>Name</dt><dd>{dev.name}</dd>
              <dt>Type</dt><dd>{dev.type ?? "—"}</dd>
              <dt>Model</dt><dd>{dev.model ?? "—"}</dd>
              <dt>Firmware</dt><dd>{dev.firmwareVersion ? `v${dev.firmwareVersion}` : "—"}</dd>
              <dt>Capabilities</dt><dd>{capabilities.length}</dd>
            </dl>
          </div>
          <div className="card">
            <h3 className="card-title">Danger zone</h3>
            {!canAdmin ? (
              <p style={{ color: "var(--text-dim)", fontSize: 13.5 }}>
                You need ADMIN or OWNER role to rotate credentials or delete this device.
              </p>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 650, marginBottom: 6 }}>Rotate credentials</div>
                  <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "0 0 10px" }}>
                    Issues a new device token and invalidates the old one immediately.
                  </p>
                  <button className="btn btn-sm" onClick={rotate}>Rotate token</button>
                  {rotatedToken && (
                    <div style={{ marginTop: 12 }}>
                      <div className="warning-banner" style={{ marginBottom: 10 }}>
                        <span className="wb-icon">⚠️</span>
                        <span>New token — shown once. The previous token no longer works.</span>
                      </div>
                      <div className="secret-box">
                        <code>{rotatedToken}</code>
                        <CopyButton text={rotatedToken} />
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 650, marginBottom: 6 }}>Delete device</div>
                  <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "0 0 10px" }}>
                    Removes the device, its telemetry history and automations.
                  </p>
                  <button className="btn btn-danger btn-sm" onClick={remove} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete device"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- tabs ---------- */

function OverviewTab({
  capabilities, latest, telemetry, onCommand, canControl, busyCap,
}: {
  capabilities: Capability[];
  latest: Record<string, TelemetryValue>;
  telemetry: Record<string, { ts: number; value: number }[]>;
  onCommand: (cap: string, action: string, params: Record<string, unknown>) => void;
  canControl: boolean;
  busyCap: string | null;
}) {
  if (capabilities.length === 0) {
    return (
      <div className="card">
        <EmptyState icon="◌" title="No capabilities" body="This device has not published its manifest yet." />
      </div>
    );
  }
  return (
    <div className="grid grid-widgets">
      {capabilities.map((cap) => (
        <CapabilityWidget
          key={cap.id}
          capability={cap}
          value={latest[cap.id]}
          series={telemetry[cap.id]}
          onCommand={onCommand}
          canControl={canControl}
          busy={busyCap === cap.id}
        />
      ))}
    </div>
  );
}

function ControlsTab({
  actuators, latest, onCommand, canControl, busyCap, commands,
}: {
  actuators: Capability[];
  latest: Record<string, TelemetryValue>;
  onCommand: (cap: string, action: string, params: Record<string, unknown>) => void;
  canControl: boolean;
  busyCap: string | null;
  commands: CommandRecord[];
}) {
  return (
    <>
      {!canControl && (
        <div className="warning-banner" style={{ marginBottom: 16 }}>
          <span className="wb-icon">👁</span>
          <span>You have the <strong>VIEWER</strong> role — controls are disabled. Contact an admin to change your role.</span>
        </div>
      )}
      {actuators.length === 0 ? (
        <div className="card">
          <EmptyState icon="🎛" title="No actuators" body="This device exposes no controllable capabilities." />
        </div>
      ) : (
        <div className="grid grid-widgets" style={{ marginBottom: 22 }}>
          {actuators.map((cap) => (
            <CapabilityWidget
              key={cap.id}
              capability={cap}
              value={latest[cap.id]}
              onCommand={onCommand}
              canControl={canControl}
              busy={busyCap === cap.id}
            />
          ))}
        </div>
      )}
      <div className="card">
        <h3 className="card-title">Command history</h3>
        {commands.length === 0 ? (
          <EmptyState icon="📤" title="No commands yet" body="Commands you issue will appear here with live status updates." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Capability</th>
                  <th>Action</th>
                  <th>Params</th>
                  <th>Issued</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((c) => (
                  <tr key={c.commandId}>
                    <td className="mono" title={c.commandId}>{c.commandId.slice(0, 12)}…</td>
                    <td className="mono">{c.capabilityId}</td>
                    <td>{c.action}</td>
                    <td className="mono" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {JSON.stringify(c.params)}
                    </td>
                    <td title={fmtTime(c.issuedAt)}>{timeAgo(c.issuedAt)}</td>
                    <td>
                      <span className={`cmd-status ${c.status.toUpperCase()}`}>
                        ● {c.status.toUpperCase()}
                      </span>
                      {c.result?.reason && (
                        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{c.result.reason}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function HealthTab({ health, capabilities }: { health: Health | null; capabilities: Capability[] }) {
  if (!health) {
    return (
      <div className="card">
        <EmptyState icon="💚" title="No health data" body="The device hasn't reported a health snapshot yet." />
      </div>
    );
  }
  const uptimeH = Math.floor(health.uptime / 3600);
  const rssi = health.wifiRssi;
  const rssiCls = rssi === undefined ? "neutral" : rssi > -60 ? "online" : rssi > -75 ? "degraded" : "offline";
  return (
    <div className="grid grid-2">
      <div className="card">
        <h3 className="card-title">System</h3>
        <div className="health-row"><span className="hr-label">Uptime</span><span>{uptimeH}h {Math.floor((health.uptime % 3600) / 60)}m</span></div>
        <div className="health-row"><span className="hr-label">Firmware</span><span className="mono">v{health.firmware}</span></div>
        <div className="health-row"><span className="hr-label">MQTT</span><span className={`pill ${health.mqtt === "connected" ? "online" : "offline"}`}>{health.mqtt}</span></div>
        <div className="health-row"><span className="hr-label">Wi-Fi RSSI</span><span className={`pill ${rssiCls}`}>{rssi !== undefined ? `${rssi} dBm` : "—"}</span></div>
        <div className="health-row"><span className="hr-label">Free heap</span><span>{health.freeHeap !== undefined ? `${(health.freeHeap / 1024).toFixed(1)} KB` : "—"}</span></div>
        <div className="health-row"><span className="hr-label">Sensor errors</span><span className={health.sensorErrors > 0 ? "stat-value warn" : ""} style={{ fontSize: 14 }}>{health.sensorErrors}</span></div>
        <div className="health-row"><span className="hr-label">Last telemetry</span><span>{timeAgo(health.lastTelemetryAt)}</span></div>
        <div className="health-row"><span className="hr-label">Reported</span><span>{timeAgo(health.at)}</span></div>
      </div>
      <div className="card">
        <h3 className="card-title">Per-capability health</h3>
        {capabilities.length === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>No capabilities known.</p>
        ) : (
          capabilities.map((cap) => {
            const h = health.capabilityHealth[cap.id] ?? "unknown";
            return (
              <div className="health-row" key={cap.id}>
                <span className="hr-label mono">{cap.id}</span>
                <span className={`pill ${h === "good" ? "online" : h === "error" ? "offline" : "neutral"}`}>
                  <span className="dot" />{h}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function EventsTab({ deviceId, commands }: { deviceId: string; commands: CommandRecord[] }) {
  const { events } = useRealtimeState();
  const deviceEvents = events.filter((e) => e.deviceId === deviceId);

  const feed = useMemo(() => {
    const items: { at: number; el: React.ReactNode; key: string }[] = [];
    for (const c of commands) {
      items.push({
        at: c.issuedAt,
        key: `cmd-${c.commandId}`,
        el: (
          <>
            <span>📤</span>
            <span>
              Command <span className="mono">{c.commandId.slice(0, 12)}…</span> →{" "}
              <span className="mono">{c.capabilityId}</span>.{c.action}{" "}
              <span className={`cmd-status ${c.status.toUpperCase()}`}>{c.status.toUpperCase()}</span>
            </span>
          </>
        ),
      });
    }
    for (const e of deviceEvents) {
      items.push({
        at: e.at,
        key: `ev-${e.at}-${e.kind}`,
        el: <EventLine event={e} />,
      });
    }
    return items.sort((a, b) => b.at - a.at).slice(0, 60);
  }, [commands, deviceEvents]);

  if (feed.length === 0) {
    return (
      <div className="card">
        <EmptyState icon="🗞" title="No events yet" body="Realtime events and commands for this device will stream in here." />
      </div>
    );
  }
  return (
    <div className="card">
      <h3 className="card-title">Event feed</h3>
      <div className="feed">
        {feed.map((f) => (
          <div className="feed-item" key={f.key}>
            {f.el}
            <span className="fi-time">{fmtTime(f.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventLine({ event }: { event: { kind: string; data: Record<string, unknown> } }) {
  const d = event.data;
  switch (event.kind) {
    case "device.online":
      return <><span>🟢</span><span>Device came online</span></>;
    case "device.offline":
      return <><span>🔴</span><span>Device went offline</span></>;
    case "device.telemetry": {
      const vals = d.values as Record<string, unknown> | undefined;
      const summary = vals ? Object.entries(vals).slice(0, 4).map(([k, v]) => `${k}=${String(v)}`).join(" ") : "";
      return <><span>📈</span><span className="mono" style={{ fontSize: 12 }}>telemetry {summary}</span></>;
    }
    case "device.state_changed":
      return <><span>🔄</span><span>State changed</span></>;
    case "device.health":
      return <><span>💚</span><span>Health snapshot received</span></>;
    case "command.created":
      return <><span>📤</span><span>Command <span className="mono">{String(d.commandId ?? "").slice(0, 12)}…</span> created</span></>;
    case "command.acknowledged":
      return <><span>📥</span><span>Command <span className="mono">{String(d.commandId ?? "").slice(0, 12)}…</span> acknowledged</span></>;
    case "command.failed":
      return <><span>⚠️</span><span>Command <span className="mono">{String(d.commandId ?? "").slice(0, 12)}…</span> failed{d.reason ? `: ${String(d.reason)}` : ""}</span></>;
    case "automation.triggered":
      return <><span>⚡</span><span>Automation {String(d.automationId ?? d.name ?? "")} triggered</span></>;
    default:
      return <><span>•</span><span>{event.kind}</span></>;
  }
}
