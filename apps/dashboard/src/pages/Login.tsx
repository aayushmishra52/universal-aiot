import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <p style={{ marginTop: 18, fontSize: 13.5, color: "var(--text-dim)" }}>
            No account yet? <Link to="/register">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
