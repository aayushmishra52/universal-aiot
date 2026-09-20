import { useTheme } from "../theme/ThemeContext";

const ACCENTS = [
  "#6e56cf", // violet
  "#0ea5a4", // teal
  "#e0633a", // ember
  "#d64570", // rose
  "#2f7fe0", // blue
  "#8fb62e", // lime
  "#b48a2e", // gold
];

const CARDS = [
  { id: "stats", label: "Fleet stat cards", desc: "Total / online / offline / alerts overview on the Devices page." },
  { id: "activity", label: "Live activity feed", desc: "Realtime event stream under the device grid." },
];

export function SettingsPage() {
  const { mode, setMode, accent, setAccent, hiddenCards, setCardHidden } = useTheme();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Appearance and dashboard layout preferences.</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3 className="card-title">Appearance</h3>
          <div className="field">
            <label>Theme mode</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["dark", "light"] as const).map((m) => (
                <button
                  key={m}
                  className={`btn btn-sm ${mode === m ? "btn-primary" : ""}`}
                  onClick={() => setMode(m)}
                  style={{ textTransform: "capitalize" }}
                >
                  {m === "dark" ? "☾ Dark" : "☀ Light"}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Accent color</label>
            <div className="swatches">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  className={`swatch${accent.toLowerCase() === c.toLowerCase() ? " active" : ""}`}
                  style={{ background: c }}
                  title={c}
                  aria-label={`Accent ${c}`}
                  onClick={() => setAccent(c)}
                />
              ))}
              <label
                className="swatch"
                title="Custom color"
                style={{
                  background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  fontSize: 16,
                }}
              >
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  style={{ opacity: 0, width: 0, height: 0, position: "absolute" }}
                  aria-label="Custom accent color"
                />
                +
              </label>
            </div>
            <div className="mono" style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8 }}>
              {accent}
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Dashboard layout</h3>
          <p style={{ color: "var(--text-dim)", fontSize: 13.5, margin: "0 0 14px" }}>
            Choose which cards appear on the Devices page.
          </p>
          {CARDS.map((c) => {
            const hidden = !!hiddenCards[c.id];
            return (
              <label
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border-soft)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={(e) => setCardHidden(c.id, !e.target.checked)}
                  style={{ marginTop: 4, accentColor: "var(--accent)", width: 16, height: 16 }}
                />
                <span>
                  <div style={{ fontWeight: 650 }}>{c.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{c.desc}</div>
                </span>
              </label>
            );
          })}
          <p style={{ color: "var(--text-faint)", fontSize: 12.5, margin: "14px 0 0" }}>
            Preferences are stored locally in your browser.
          </p>
        </div>
      </div>
    </div>
  );
}
