import { useState } from "react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-row">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon = "◌",
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="es-icon">{icon}</div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function StatusPill({ status }: { status?: string }) {
  const s = (status ?? "unknown").toLowerCase();
  const cls = s === "online" ? "online" : s === "degraded" ? "degraded" : s === "offline" ? "offline" : "neutral";
  return (
    <span className={`pill ${cls}`}>
      <span className="dot" />
      {s}
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? "✓ Copied" : `⧉ ${label}`}
    </button>
  );
}

export function timeAgo(ts?: number): string {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtTime(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}
