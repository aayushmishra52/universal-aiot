import { useCallback, useEffect, useState } from "react";
import {
  listCredentials,
  provisionCredentials,
  revokeCredential,
  type CredentialMeta,
  type IssuedCredential,
} from "../api/credentials";
import { CopyButton, ErrorBanner, Loading, fmtTime, timeAgo } from "./common";

const AVAILABLE_SCOPES = ["telemetry", "commands"];

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CredentialsModal({
  deviceId,
  deviceName,
  onClose,
}: {
  deviceId: string;
  deviceName: string;
  onClose: () => void;
}) {
  const [creds, setCreds] = useState<CredentialMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>([...AVAILABLE_SCOPES]);
  const [provisioning, setProvisioning] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCreds(await listCredentials(deviceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const toggleScope = (s: string) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const onProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (provisioning) return;
    setProvisioning(true);
    setError(null);
    try {
      const res = await provisionCredentials(deviceId, {
        label: label.trim() || undefined,
        scopes,
      });
      setIssued(res);
      setLabel("");
      setScopes([...AVAILABLE_SCOPES]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provisioning failed");
    } finally {
      setProvisioning(false);
    }
  };

  const onRevoke = async (cred: CredentialMeta) => {
    if (!window.confirm(`Revoke credential "${cred.clientId}"? Devices using it will be disconnected.`))
      return;
    setRevoking(cred.id);
    setError(null);
    try {
      await revokeCredential(deviceId, cred.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revocation failed");
    } finally {
      setRevoking(null);
    }
  };

  const downloadEnv = (c: IssuedCredential) =>
    download(
      "aiot.credentials.env",
      [
        "# Universal AIoT device credentials — KEEP SECRET, do not commit.",
        `# device: ${deviceId} (${deviceName})`,
        `# issued: ${new Date(c.createdAt).toISOString()}`,
        `AIOT_MQTT_USER=${c.clientId}`,
        `AIOT_MQTT_PASSWORD=${c.secret}`,
        "",
      ].join("\n"),
      "text/plain",
    );

  const downloadJson = (c: IssuedCredential) =>
    download(
      "aiot.credentials.json",
      JSON.stringify(
        {
          deviceId,
          deviceName,
          clientId: c.clientId,
          secret: c.secret,
          label: c.label,
          scopes: c.scopes,
          createdAt: c.createdAt,
        },
        null,
        2,
      ),
      "application/json",
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Credentials for ${deviceName}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "48px 16px",
        zIndex: 100,
        overflowY: "auto",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 640, margin: 0 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <h2 className="card-title" style={{ margin: 0, flex: 1 }}>
            🔑 Credentials — {deviceName}
          </h2>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "0 0 16px" }}>
          Devices authenticate to the MQTT broker with a <span className="mono">clientId</span> /
          secret pair. Secrets are shown <strong>once</strong> — store them in the device firmware
          or a <span className="mono">.env</span> file.
        </p>

        {error && (
          <div style={{ marginBottom: 14 }}>
            <ErrorBanner message={error} />
          </div>
        )}

        {issued ? (
          <div className="card" style={{ borderColor: "var(--warn, #b98a1d)", marginBottom: 16 }}>
            <h3 className="card-title">⚠️ Copy now — this secret will never be shown again</h3>
            <div className="field">
              <label>Client ID (MQTT username)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code className="mono" style={{ flex: 1, wordBreak: "break-all" }}>{issued.clientId}</code>
                <CopyButton text={issued.clientId} label="Copy" />
              </div>
            </div>
            <div className="field">
              <label>Secret (MQTT password)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code className="mono" style={{ flex: 1, wordBreak: "break-all" }}>{issued.secret}</code>
                <CopyButton text={issued.secret} label="Copy" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button className="btn btn-sm" onClick={() => downloadEnv(issued)}>
                ⤓ Download .env
              </button>
              <button className="btn btn-sm" onClick={() => downloadJson(issued)}>
                ⤓ Download JSON
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setIssued(null)}
                style={{ marginLeft: "auto" }}
              >
                I've saved it — done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onProvision} className="card" style={{ marginBottom: 16 }}>
            <h3 className="card-title">Provision new credential</h3>
            <div className="field">
              <label htmlFor="cred-label">Label (optional)</label>
              <input
                id="cred-label"
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. rooftop sensor"
                maxLength={100}
              />
            </div>
            <div className="field">
              <label>Scopes</label>
              <div style={{ display: "flex", gap: 16 }}>
                {AVAILABLE_SCOPES.map((s) => (
                  <label key={s} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: "normal" }}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={() => toggleScope(s)}
                    />
                    <span className="mono">{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" disabled={provisioning || scopes.length === 0}>
              {provisioning ? "Provisioning…" : "+ Provision credential"}
            </button>
          </form>
        )}

        <h3 className="card-title">Existing credentials ({creds.length})</h3>
        {loading ? (
          <Loading label="Loading credentials…" />
        ) : creds.length === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>No credentials yet. Provision one above.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {creds.map((c) => (
              <div
                key={c.id}
                className="card"
                style={{
                  margin: 0,
                  padding: "10px 14px",
                  opacity: c.revokedAt ? 0.6 : 1,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ wordBreak: "break-all" }}>{c.clientId}</div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      {c.label && <span>“{c.label}” · </span>}
                      <span title={c.scopes.join(", ")}>scopes: {c.scopes.join(", ") || "—"}</span>
                      {" · "}created {timeAgo(c.createdAt)}
                      {c.lastUsedAt ? ` · last used ${timeAgo(c.lastUsedAt)}` : " · never used"}
                      {c.revokedAt && (
                        <span title={fmtTime(c.revokedAt)}> · revoked {timeAgo(c.revokedAt)}</span>
                      )}
                    </div>
                  </div>
                  {!c.revokedAt && (
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={revoking === c.id}
                      onClick={() => onRevoke(c)}
                    >
                      {revoking === c.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
