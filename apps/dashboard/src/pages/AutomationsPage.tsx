import { useCallback, useEffect, useMemo, useState } from "react";
import type { Capability } from "@aiot/contracts";
import {
  ApiError,
  createAutomation,
  deleteAutomation,
  getDevice,
  listAutomations,
  listDevices,
  updateAutomation,
  type Automation,
  type DeviceSummary,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSelection } from "../components/Layout";
import { EmptyState, ErrorBanner, Loading } from "../components/common";

const OPERATORS = [">", ">=", "<", "<=", "==", "!="] as const;

export function AutomationsPage() {
  const { projectId, orgId } = useSelection();
  const { roleFor } = useAuth();
  const canAdmin = ["OWNER", "ADMIN"].includes(roleFor(orgId) ?? "");

  const [automations, setAutomations] = useState<Automation[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setAutomations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [autos, devs] = await Promise.all([
        listAutomations(projectId),
        listDevices(projectId).catch(() => [] as DeviceSummary[]),
      ]);
      setAutomations(autos);
      setDevices(devs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (a: Automation) => {
    if (!projectId || !a.id) return;
    try {
      const updated = await updateAutomation(projectId, a.id, { enabled: !a.enabled });
      setAutomations((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const remove = async (a: Automation) => {
    if (!projectId || !a.id) return;
    if (!window.confirm(`Delete automation "${a.name}"?`)) return;
    try {
      await deleteAutomation(projectId, a.id);
      setAutomations((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading) return <div className="page"><Loading label="Loading automations…" /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Automations</h1>
          <p className="page-sub">If-this-then-that rules evaluated against live telemetry.</p>
        </div>
        {canAdmin && projectId && (
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close" : "+ New automation"}
          </button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}

      {!projectId && (
        <div className="card">
          <EmptyState icon="⚡" title="Select a project" body="Automations live inside a project. Pick one from the top bar." />
        </div>
      )}

      {projectId && showForm && canAdmin && (
        <AutomationForm
          projectId={projectId}
          devices={devices}
          onCreated={(a) => {
            setAutomations((prev) => [a, ...prev]);
            setShowForm(false);
          }}
          onError={setError}
        />
      )}

      {projectId && !loading && automations.length === 0 && !showForm && (
        <div className="card">
          <EmptyState
            icon="⚡"
            title="No automations yet"
            body="Create a rule like: when soil moisture drops below 30%, turn the pump on."
            action={canAdmin ? <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ New automation</button> : undefined}
          />
        </div>
      )}

      {automations.length > 0 && (
        <div className="card">
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                  <th>Condition</th>
                  <th>Action</th>
                  <th>Status</th>
                  {canAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {automations.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 650 }}>{a.name}</td>
                    <td className="mono">{a.deviceId ?? "all devices"}</td>
                    <td className="mono">
                      {a.condition.capabilityId} {a.condition.operator}{" "}
                      {String(a.condition.value)}
                    </td>
                    <td className="mono">
                      {a.action.capabilityId}.{a.action.action}
                      {a.action.params ? ` ${JSON.stringify(a.action.params)}` : ""}
                    </td>
                    <td>
                      <span className={`pill ${a.enabled ? "online" : "neutral"}`}>
                        {a.enabled ? "enabled" : "disabled"}
                      </span>
                    </td>
                    {canAdmin && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => toggle(a)}>
                          {a.enabled ? "Disable" : "Enable"}
                        </button>{" "}
                        <button className="btn btn-sm btn-danger" onClick={() => remove(a)}>
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!canAdmin && projectId && automations.length > 0 && (
        <p style={{ color: "var(--text-faint)", fontSize: 12.5, marginTop: 12 }}>
          You need ADMIN or OWNER role to create or edit automations.
        </p>
      )}
    </div>
  );
}

function AutomationForm({
  projectId,
  devices,
  onCreated,
  onError,
}: {
  projectId: string;
  devices: DeviceSummary[];
  onCreated: (a: Automation) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [condCap, setCondCap] = useState("");
  const [operator, setOperator] = useState<string>(">");
  const [condValue, setCondValue] = useState("");
  const [actCap, setActCap] = useState("");
  const [actValue, setActValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!deviceId) {
      setCapabilities([]);
      return;
    }
    getDevice(deviceId)
      .then((d) => setCapabilities(d.capabilities ?? []))
      .catch(() => setCapabilities([]));
  }, [deviceId]);

  const condCapability = useMemo(
    () => capabilities.find((c) => c.id === condCap),
    [capabilities, condCap],
  );
  const actCapability = useMemo(
    () => capabilities.find((c) => c.id === actCap),
    [capabilities, actCap],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const numVal = Number(condValue);
      const conditionValue =
        condCapability && (condCapability.type === "number" || condCapability.type === "integer") && condValue !== "" && !Number.isNaN(numVal)
          ? numVal
          : condValue === "true" ? true : condValue === "false" ? false : condValue;

      let actionParams: Record<string, unknown>;
      if (actCapability?.type === "boolean") {
        actionParams = { value: actValue === "true" };
      } else if (actCapability && (actCapability.type === "number" || actCapability.type === "integer")) {
        const n = Number(actValue);
        if (Number.isNaN(n)) throw new Error("Action value must be a number");
        actionParams = { value: actCapability.type === "integer" ? Math.round(n) : n };
      } else {
        actionParams = { value: actValue };
      }

      const created = await createAutomation(projectId, {
        name: name.trim(),
        deviceId: deviceId || undefined,
        enabled: true,
        condition: { capabilityId: condCap, operator: operator as (typeof OPERATORS)[number], value: conditionValue },
        action: { capabilityId: actCap, action: "set", params: actionParams },
      });
      onCreated(created);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create automation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-title">New automation</h3>
      <form onSubmit={submit}>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="aname">Name</label>
            <input id="aname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Water when dry" required />
          </div>
          <div className="field">
            <label htmlFor="adevice">Device scope</label>
            <select id="adevice" className="select" value={deviceId} onChange={(e) => { setDeviceId(e.target.value); setCondCap(""); setActCap(""); }}>
              <option value="">All devices in project</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.name} ({d.deviceId})</option>
              ))}
            </select>
          </div>
        </div>

        <div className="card card-flat" style={{ marginBottom: 16, background: "var(--bg-elev)" }}>
          <h3 className="card-title">When… (condition)</h3>
          <div className="grid grid-3">
            <div className="field">
              <label htmlFor="ccap">Capability</label>
              <select id="ccap" className="select" value={condCap} onChange={(e) => setCondCap(e.target.value)} required disabled={!deviceId}>
                <option value="">{deviceId ? "Select…" : "Pick a device first"}</option>
                {capabilities.filter((c) => c.kind !== "actuator").map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cop">Operator</label>
              <select id="cop" className="select" value={operator} onChange={(e) => setOperator(e.target.value)}>
                {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cval">Value</label>
              <input id="cval" className="input" value={condValue} onChange={(e) => setCondValue(e.target.value)} placeholder="e.g. 30" required />
            </div>
          </div>
        </div>

        <div className="card card-flat" style={{ marginBottom: 16, background: "var(--bg-elev)" }}>
          <h3 className="card-title">Then… (action)</h3>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="acap">Actuator capability</label>
              <select id="acap" className="select" value={actCap} onChange={(e) => setActCap(e.target.value)} required disabled={!deviceId}>
                <option value="">{deviceId ? "Select…" : "Pick a device first"}</option>
                {capabilities.filter((c) => c.kind === "actuator" && c.readOnly !== true).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="aval">Set value</label>
              {actCapability?.type === "boolean" ? (
                <select id="aval" className="select" value={actValue} onChange={(e) => setActValue(e.target.value)} required>
                  <option value="">Select…</option>
                  <option value="true">true (on)</option>
                  <option value="false">false (off)</option>
                </select>
              ) : actCapability?.type === "enum" ? (
                <select id="aval" className="select" value={actValue} onChange={(e) => setActValue(e.target.value)} required>
                  <option value="">Select…</option>
                  {(actCapability.enumValues ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input id="aval" className="input" value={actValue} onChange={(e) => setActValue(e.target.value)} placeholder="Value to set" required />
              )}
            </div>
          </div>
        </div>

        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create automation"}
        </button>
      </form>
    </div>
  );
}
