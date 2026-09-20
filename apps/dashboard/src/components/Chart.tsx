/** Lightweight SVG time-series chart — no chart library. */
import { useId, useMemo } from "react";

export interface ChartPoint {
  ts: number;
  value: number;
}

interface ChartProps {
  series: ChartPoint[];
  color?: string;
  unit?: string;
  height?: number;
}

export function Chart({ series, color, unit, height = 120 }: ChartProps) {
  // useId() may contain ":" which breaks SVG url(#id) references — strip them.
  const gid = `g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const W = 560;
  const H = 200;
  const PAD = 8;

  const path = useMemo(() => {
    if (series.length === 0) return null;
    const vals = series.map((p) => p.value);
    const tss = series.map((p) => p.ts);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const spanV = maxV - minV || 1;
    const minT = Math.min(...tss);
    const maxT = Math.max(...tss);
    const spanT = maxT - minT || 1;
    const pts = series.map((p) => {
      const x = PAD + ((p.ts - minT) / spanT) * (W - PAD * 2);
      const y = H - PAD - ((p.value - minV) / spanV) * (H - PAD * 2);
      return [x, y] as const;
    });
    if (pts.length === 1) {
      const [x, y] = pts[0];
      return { line: `M ${x} ${y} L ${x} ${y}`, area: null, last: pts[0], minV, maxV };
    }
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const [lx, ly] = pts[pts.length - 1];
    const [fx] = pts[0];
    const area = `${line} L ${lx.toFixed(1)} ${H - PAD} L ${fx.toFixed(1)} ${H - PAD} Z`;
    return { line, area, last: pts[pts.length - 1], minV, maxV };
  }, [series]);

  const stroke = color ?? "var(--accent-strong)";

  if (series.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-faint)",
          fontSize: 12.5,
          border: "1px dashed var(--border)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        No data yet — waiting for telemetry…
      </div>
    );
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block" }}
        role="img"
        aria-label={`Time series chart${unit ? ` in ${unit}` : ""}`}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {path?.area && <path d={path.area} fill={`url(#${gid})`} />}
        {path && <path d={path.line} fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {path && (
          <circle cx={path.last[0]} cy={path.last[1]} r="5" fill={stroke} stroke="#fff" strokeWidth="1.5" />
        )}
      </svg>
      {path && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--text-faint)",
            marginTop: 4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>min {path.minV.toFixed(2)}{unit ? ` ${unit}` : ""}</span>
          <span>max {path.maxV.toFixed(2)}{unit ? ` ${unit}` : ""}</span>
        </div>
      )}
    </div>
  );
}

/** Compact sparkline used inside sensor widgets. */
export function Sparkline({
  series,
  color,
}: {
  series: ChartPoint[];
  color?: string;
}) {
  const W = 220;
  const H = 44;
  const stroke = color ?? "var(--accent-strong)";
  const pts = useMemo(() => {
    if (series.length === 0) return "";
    const vals = series.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    return series
      .map((p, i) => {
        const x = 4 + (i / Math.max(series.length - 1, 1)) * (W - 8);
        const y = H - 4 - ((p.value - min) / span) * (H - 8);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series]);
  if (!pts) return <div className="spark" />;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="spark" aria-hidden="true">
      <path d={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
