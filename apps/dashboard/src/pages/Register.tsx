import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(email.trim(), password, name.trim());
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
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
            Create your account
          </h1>
          <p className="page-sub" style={{ marginBottom: 22 }}>
            Registration creates your first organization — you become its owner.
          </p>
          {error && (
            <div className="error-banner" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                className="input"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
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
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
          <p style={{ marginTop: 18, fontSize: 13.5, color: "var(--text-dim)" }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
