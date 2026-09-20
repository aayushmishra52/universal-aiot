import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, pairDevice, type PairResult } from "../api/client";
import { CopyButton, ErrorBanner } from "../components/common";

export function PairDevicePage() {
  const navigate = useNavigate();
  const [deviceId, setDeviceId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PairResult | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await pairDevice({
        deviceId: deviceId.trim().toUpperCase(),
        username: username.trim(),
        password,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Pairing failed");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 600, margin: "4vh auto" }}>
          <h1 className="page-title" style={{ fontSize: 20, marginBottom: 6 }}>
            Device paired ✓
          </h1>
          <p className="page-sub" style={{ marginBottom: 20 }}>
            <span className="mono">{result.deviceId}</span> is now linked to your fleet
            {result.rotated ? " with freshly rotated credentials." : "."}
          </p>
          <div className="warning-banner" style={{ marginBottom: 16 }}>
            <span className="wb-icon">⚠️</span>
            <span>
              <strong>This device token is shown only once.</strong> It replaces the
              one-time pairing password for all future authentication. Store it
              securely on the device — it cannot be retrieved again.
            </span>
          </div>
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 6 }}>
              Device token (one-time)
            </div>
            <div className="secret-box">
              <code>{result.deviceToken}</code>
              <CopyButton text={result.deviceToken} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link to={`/devices/${result.deviceId}`} className="btn btn-primary" style={{ textDecoration: "none" }}>
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
          <h1 className="page-title">Pair a device</h1>
          <p className="page-sub">
            Exchange the one-time pairing credentials for a long-lived device token.
          </p>
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
            <label htmlFor="pid">Device ID</label>
            <input
              id="pid"
              className="input mono"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="DEV-ABCDE"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="puser">Pairing username</label>
            <input
              id="puser"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="From the device creation step"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ppass">Pairing password</label>
            <input
              id="ppass"
              className="input mono"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="One-time password"
              required
            />
          </div>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Pairing…" : "Pair device"}
          </button>
        </form>
      </div>
    </div>
  );
}
