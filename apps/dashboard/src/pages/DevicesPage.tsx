import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listCommands,
  listDevices,
  type CommandRecord,
  type DeviceSummary,
} from "../api/client";
import { useSelection } from "../components/Layout";
import { useRealtimeState } from "../ws/RealtimeContext";
import { useTheme } from "../theme/ThemeContext";
import {
  EmptyState,
  ErrorBanner,
  Loading,
  StatusPill,
  fmtTime,
  timeAgo,
} from "../components/common";

export function DevicesPage() {
  const { projectId, projects, addProject, loading: selLoading, error: selError } = useSelection();
  const { events } = useRealtimeState();
  const { hiddenCards } = useTheme();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentFails, setRecentFails] = useState(0);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const load = useCallback(async () => {
    if (!projectId) {
      setDevices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await listDevices(projectId);
      setDevices(list);
      // Count recently failed commands across devices (alerts stat)
      const cmdLists = await Promise.all(
        list.slice(0, 20).map((d) => listCommands(d.deviceId, 10).catch(() => [] as CommandRecord[])),
      );
      const fails = cmdLists
        .flat()
        .filter((c) => ["FAILED", "EXPIRED", "REJECTED"].includes(c.status.toUpperCase()))
        .length;
      setRecentFails(fails);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Merge realtime presence events into the device list
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

  const online = liveDevices.filter((d) => d.status === "online").length;
  const offline = liveDevices.length - online;

  const activity = useMemo(
    () =>
      events
        .filter((e) => ["device.telemetry", "command.created", "command.failed", "automation.triggered", "device.online", "device.offline"].includes(e.kind))
        .slice(0, 12),
    [events],
  );

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    await addProject(newProjectName.trim());
    setNewProjectName("");
    setShowNewProject(false);
  };

  if (selLoading) return <div className="page"><Loading label="Loading workspace…" /></div>;
  if (selError) return <div className="page"><ErrorBanner message={selError} /></div>;

  if (!projectId) {
    return (
      <div className="page">
        <EmptyState
          icon="◈"
          title={projects.length === 0 ? "Create your first project" : "Select a project"}
          body={
            projects.length === 0
              ? "Projects group your devices. Create one to get started."
              : "Choose a project from the top bar to see its devices."
          }
          action={
            <button className="btn btn-primary" onClick={() => setShowNewProject((v) => !v)}>
              + New project
            </button>
          }
        />
        {showNewProject && (
          <div className="card" style={{ maxWidth: 460, margin: "0 auto" }}>
            <form onSubmit={createProject}>
              <div className="field">
                <label htmlFor="np">Project name</label>
                <input
                  id="np"
                  className="input"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. Greenhouse A"
                  required
                />
              </div>
              <button className="btn btn-primary">Create project</button>
            </form>
          </div>
        )}
      </div>
    );
  }

  const cardVisible = (id: string) => !hiddenCards[id];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Devices</h1>
          <p className="page-sub">
            {projects.find((p) => p.id === projectId)?.name} · {devices.length} device{devices.length === 1 ? "" : "s"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setShowNewProject((v) => !v)}>
            + Project
          </button>
          <Link to="/devices/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
            + Add device
          </Link>
        </div>
      </div>

      {showNewProject && (
        <div className="card" style={{ maxWidth: 460, marginBottom: 18 }}>
          <form onSubmit={createProject}>
            <div className="field">
              <label htmlFor="np2">Project name</label>
              <input
                id="np2"
                className="input"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g. Greenhouse A"
                required
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary btn-sm">Create</button>
              <button type="button" className="btn btn-sm" onClick={() => setShowNewProject(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}

      {loading ? (
        <div className="grid grid-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card"><div className="skeleton" style={{ height: 90 }} /></div>
          ))}
        </div>
      ) : (
        <>
          {cardVisible("stats") && (
            <div className="grid grid-4" style={{ marginBottom: 22 }}>
              <div className="stat">
                <div className="stat-label">Total devices</div>
                <div className="stat-value">{devices.length}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Online</div>
                <div className={`stat-value ${online > 0 ? "ok" : ""}`}>{online}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Offline</div>
                <div className={`stat-value ${offline > 0 ? "bad" : ""}`}>{offline}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Command alerts</div>
                <div className={`stat-value ${recentFails > 0 ? "warn" : ""}`}>{recentFails}</div>
              </div>
            </div>
          )}

          {devices.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="📡"
                title="No devices yet"
                body="Add your first device to start streaming telemetry. You'll get one-time pairing credentials to flash onto the hardware."
                action={
                  <Link to="/devices/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
                    + Add device
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="grid grid-3">
              {liveDevices.map((d) => (
                <Link key={d.deviceId} to={`/devices/${d.deviceId}`} className="device-card">
                  <div className="dc-top">
                    <h3 className="dc-name">{d.name}</h3>
                    <StatusPill status={d.status} />
                  </div>
                  <div className="dc-id">{d.deviceId}</div>
                  <div className="dc-meta">
                    {d.model && <span>▦ {d.model}</span>}
                    {d.firmwareVersion && <span>v{d.firmwareVersion}</span>}
                    {d.capabilityCount !== undefined && <span>{d.capabilityCount} capabilities</span>}
                  </div>
                  <div className="dc-meta" style={{ fontSize: 12 }}>
                    <span title={fmtTime(d.lastSeen)}>Last seen {timeAgo(d.lastSeen)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {cardVisible("activity") && activity.length > 0 && (
            <div className="card" style={{ marginTop: 22 }}>
              <h3 className="card-title">Live activity</h3>
              <div className="feed">
                {activity.map((e, i) => (
                  <div className="feed-item" key={`${e.at}-${e.kind}-${i}`}>
                    <ActivityIcon kind={e.kind} />
                    <span style={{ color: "var(--text-dim)" }}>
                      <ActivityText event={e} />
                    </span>
                    <span className="fi-time">{fmtTime(e.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  const icon =
    kind === "device.online" ? "🟢" :
    kind === "device.offline" ? "🔴" :
    kind === "device.telemetry" ? "📈" :
    kind === "command.created" ? "📤" :
    kind === "command.failed" ? "⚠️" : "⚡";
  return <span>{icon}</span>;
}

function ActivityText({ event }: { event: { kind: string; deviceId?: string; data: Record<string, unknown> } }) {
  const dev = event.deviceId ? <span className="mono">{event.deviceId}</span> : "project";
  switch (event.kind) {
    case "device.online":
      return <>{dev} came online</>;
    case "device.offline":
      return <>{dev} went offline</>;
    case "device.telemetry": {
      const keys = Object.keys((event.data.values as Record<string, unknown> | undefined) ?? {});
      return <>{dev} telemetry: {keys.slice(0, 3).join(", ")}{keys.length > 3 ? "…" : ""}</>;
    }
    case "command.created":
      return <>Command {(event.data.commandId as string) ?? ""} issued to {dev}</>;
    case "command.failed":
      return <>Command {(event.data.commandId as string) ?? ""} failed on {dev}</>;
    case "automation.triggered":
      return <>Automation {(event.data.automationId as string) ?? (event.data.name as string) ?? ""} triggered</>;
    default:
      return <>{event.kind} — {dev}</>;
  }
}
