import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { API_BASE, ApiError, setToken } from "../api/client";
import {
  getFirebaseConfig,
  isFirebaseConfigured,
  signInWithFirebaseRest,
} from "../firebase-config";

export function Login() {
  const { login, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Firebase auth is optional: the backend advertises it via /api/meta.
  const [firebaseAvailable, setFirebaseAvailable] = useState(false);
  const [showFirebase, setShowFirebase] = useState(false);
  // Dashboard-side config (from the gitignored .env.local, build-time only).
  const [firebaseConfig] = useState(getFirebaseConfig);
  const firebaseRestEnabled = isFirebaseConfigured(firebaseConfig);
  const [firebaseEmail, setFirebaseEmail] = useState("");
  const [firebasePassword, setFirebasePassword] = useState("");
  const [idToken, setIdToken] = useState("");
  const [showPasteToken, setShowPasteToken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/meta`)
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (!cancelled && meta && meta.firebaseAuth === true) {
          setFirebaseAvailable(true);
        }
      })
      .catch(() => {
        /* backend unreachable or meta missing: stay with local login */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  // Exchange a verified Firebase ID token for a local JWT via the backend.
  const exchangeIdToken = async (token: string) => {
    const res = await fetch(`${API_BASE}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token.trim() }),
    });
    let data: { token?: string; error?: string } | null = null;
    try {
      data = (await res.json()) as { token?: string; error?: string };
    } catch {
      /* non-JSON body */
    }
    if (!res.ok || !data || typeof data.token !== "string") {
      throw new ApiError(res.status, data?.error ?? "Firebase sign-in failed");
    }
    setToken(data.token);
    await refresh();
    navigate("/");
  };

  // Email/password sign-in via the Firebase Auth REST API (no JS SDK needed),
  // then exchange the returned ID token for a local JWT.
  const firebaseRestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { idToken: token } = await signInWithFirebaseRest(
        firebaseEmail.trim(),
        firebasePassword,
        firebaseConfig,
      );
      await exchangeIdToken(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Firebase sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  // Fallback: paste an ID token obtained elsewhere (e.g. getIdToken() in
  // your own Firebase client) and exchange it for a local JWT.
  const firebaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await exchangeIdToken(idToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Firebase sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="form-card">
        <div className="card">
          <div className="brand" style={{ padding: 0, marginBottom: 20 }}>
            <span className="brand-mark">◈</span>
            <span>
              <div className="brand-name">AIoT Console</div>
              <div className="brand-sub">Universal AIoT</div>
            </span>
          </div>
          <h1 className="page-title" style={{ fontSize: 21, marginBottom: 4 }}>
            Welcome back
          </h1>
          <p className="page-sub" style={{ marginBottom: 22 }}>
            Sign in to manage your device fleet.
          </p>
          {error && (
            <div className="error-banner" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          {firebaseAvailable && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  margin: "18px 0 12px",
                  color: "var(--text-dim)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ flex: 1, borderTop: "1px solid var(--border, #e5e5e5)" }} />
                or
                <span style={{ flex: 1, borderTop: "1px solid var(--border, #e5e5e5)" }} />
              </div>
              <button
                className="btn"
                style={{ width: "100%" }}
                disabled={busy}
                onClick={() => setShowFirebase((v) => !v)}
              >
                Continue with Firebase
              </button>
              {showFirebase && (
                <div style={{ marginTop: 12 }}>
                  {firebaseConfig?.projectId && (
                    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-dim)" }}>
                      Firebase project: <code>{firebaseConfig.projectId}</code>
                    </p>
                  )}
                  {firebaseRestEnabled ? (
                    <form onSubmit={firebaseRestSubmit}>
                      <div className="field">
                        <label htmlFor="firebase-email">Firebase email</label>
                        <input
                          id="firebase-email"
                          className="input"
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          value={firebaseEmail}
                          onChange={(e) => setFirebaseEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="firebase-password">Firebase password</label>
                        <input
                          id="firebase-password"
                          className="input"
                          type="password"
                          autoComplete="current-password"
                          value={firebasePassword}
                          onChange={(e) => setFirebasePassword(e.target.value)}
                          required
                        />
                      </div>
                      <button
                        className="btn btn-primary"
                        style={{ width: "100%" }}
                        disabled={busy}
                      >
                        {busy ? "Signing in…" : "Sign in with Firebase"}
                      </button>
                    </form>
                  ) : (
                    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-dim)" }}>
                      Dashboard Firebase config not found — add the seven
                      <code> VITE_FIREBASE_*</code> values to
                      <code> apps/dashboard/.env.local</code> (see{" "}
                      <code>.env.example</code>) to enable email/password
                      sign-in.
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn"
                    style={{ width: "100%", marginTop: 8 }}
                    disabled={busy}
                    onClick={() => setShowPasteToken((v) => !v)}
                  >
                    {showPasteToken ? "Hide token paste" : "Have an ID token? Paste it instead"}
                  </button>
                  {showPasteToken && (
                    <form onSubmit={firebaseSubmit} style={{ marginTop: 12 }}>
                      <div className="field">
                        <label htmlFor="firebase-token">Firebase ID token</label>
                        <textarea
                          id="firebase-token"
                          className="input"
                          rows={4}
                          placeholder="Paste a Firebase ID token (getIdToken())"
                          value={idToken}
                          onChange={(e) => setIdToken(e.target.value)}
                          required
                          style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                        />
                      </div>
                      <button
                        className="btn btn-primary"
                        style={{ width: "100%" }}
                        disabled={busy || idToken.trim().length === 0}
                      >
                        {busy ? "Signing in…" : "Sign in with ID token"}
                      </button>
                    </form>
                  )}
                  <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>
                    The token is verified by the backend against your Firebase
                    project and exchanged for a local session. See{" "}
                    <code>docs/FIREBASE-AUTH.md</code> for setup.
                  </p>
                </div>
              )}
            </>
          )}
          <p style={{ marginTop: 18, fontSize: 13.5, color: "var(--text-dim)" }}>
            No account yet? <Link to="/register">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
