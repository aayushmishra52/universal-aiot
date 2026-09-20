import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, createDevice, type PairingBundle } from "../api/client";
import { useSelection } from "../components/Layout";
import { CopyButton, ErrorBanner } from "../components/common";

export function CreateDevicePage() {
  const { projectId } = useSelection();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PairingBundle | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setError(null);
    setBusy(true);
    try {
      const bundle = await createDevice(projectId, {
        name: name.trim(),
        type: type.trim() || undefined,
        model: model.trim() || undefined,
      });
      setResult(bundle);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create device");
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 520, margin: "6vh auto" }}>
          <h1 className="page-title" style={{ fontSize: 19 }}>Select a project first</h1>
          <p className="page-sub">Devices belong to a project. Pick one from the top bar, then come back.</p>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 600, margin: "4vh auto" }}>
          <h1 className="page-title" style={{ fontSize: 20, marginBottom: 6 }}>
            Device created 🎉
          </h1>
          <p className="page-sub" style={{ marginBottom: 20 }}>
            <span className="mono">{result.pairing.deviceId}</span> — {result.device.name}
          </p>
          <div className="warning-banner" style={{ marginBottom: 16 }}>
            <span className="wb-icon">⚠️</span>
            <span>
              <strong>Save these credentials now.</strong> The one-time pairing password is
              shown only once. Flash it onto the device firmware, then pair the device
              from the <Link to="/pair">pairing page</Link>.
            </span>
          </div>
          <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
            <CredentialRow label="Device ID" value={result.pairing.deviceId} />
            <CredentialRow label="Pairing username" value={result.pairing.username} />
            <CredentialRow label="Pairing password (one-time)" value={result.pairing.password} secret />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link to={`/devices/${result.pairing.deviceId}`} className="btn btn-primary" style={{ textDecoration: "none" }}>
              Open device →
            </Link>
            <button className="btn" onClick={() => navigate("/")}>Back to fleet</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Add device</h1>
          <p className="page-sub">Register a new device and get its one-time pairing credentials.</p>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 520 }}>
        {error && (
          <div style={{ marginBottom: 16 }}>
            <ErrorBanner message={error} />
          </div>
        )}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="dname">Device name</label>
            <input
              id="dname"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Greenhouse sensor 01"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="dtype">Device type <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>(optional)</span></label>
            <input
              id="dtype"
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. env-sensor"
            />
          </div>
          <div className="field">
            <label htmlFor="dmodel">Model <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>(optional)</span></label>
            <input
              id="dmodel"
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. EnvNode v2"
            />
          </div>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create device"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CredentialRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 6 }}>
        {label}
      </div>
      <div className="secret-box">
        <code>{value}</code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}
