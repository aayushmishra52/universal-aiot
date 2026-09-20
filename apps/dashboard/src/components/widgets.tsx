/**
 * Capability-driven widgets — the heart of the dashboard.
 *
 * Every control and readout is derived from the device's capability
 * manifest. Nothing is hardcoded to temperature/humidity or any other
 * specific capability: the manifest is the UI.
 */
import { useEffect, useState } from "react";
import type { Capability } from "@aiot/contracts";
import { Sparkline } from "./Chart";

export type TelemetryValue = number | string | boolean;

export interface CapabilityWidgetProps {
  capability: Capability;
  /** Latest reported (or desired) value for this capability. */
  value: TelemetryValue | undefined;
  /** Recent numeric samples for sparklines/charts. */
  series?: { ts: number; value: number }[];
  onCommand: (
    capabilityId: string,
    action: string,
    params: Record<string, unknown>,
  ) => void | Promise<void>;
  /** False for VIEWER roles — actuators render as read-only readouts. */
  canControl: boolean;
  busy?: boolean;
}

const clamp = (v: number, min?: number, max?: number) =>
  Math.min(max ?? v, Math.max(min ?? v, v));

function formatValue(cap: Capability, value: TelemetryValue | undefined): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "number") {
    const p = cap.precision ?? 2;
    return Number(value).toFixed(Math.min(p, 6));
  }
  return String(value);
}

function WidgetShell({
  cap,
  children,
  footer,
}: {
  cap: Capability;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="widget" data-capability={cap.id}>
      <div className="w-head">
        <div>
          <div className="w-name">{cap.name}</div>
          <div className="w-sub">
            {cap.id}
            {cap.category ? ` · ${cap.category}` : ""}
          </div>
        </div>
        <span className={`pill ${cap.kind === "actuator" && !cap.readOnly ? "accent" : "neutral"}`}>
          {cap.kind}
        </span>
      </div>
      {children}
      {footer}
    </div>
  );
}

function ReadOnlyValue({ capability: cap, value, series }: Pick<CapabilityWidgetProps, "capability" | "value" | "series">) {
  if (cap.type === "boolean") {
    const on = value === true;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className={`pill ${on ? "online" : "neutral"}`}>
          <span className="dot" />
          {on ? "ON" : "OFF"}
        </span>
      </div>
    );
  }
  if (cap.type === "number" || cap.type === "integer") {
    return (
      <>
        <div className="w-value">
          {formatValue(cap, value)}
          {cap.unit && <span className="unit">{cap.unit}</span>}
        </div>
        {series && series.length > 0 && <Sparkline series={series} />}
      </>
    );
  }
  // enum / string / status kinds
  return (
    <div className="w-value small">
      {value === undefined ? "—" : String(value)}
      {cap.unit && <span className="unit">{cap.unit}</span>}
    </div>
  );
}

function BooleanActuator({
  capability: cap,
  value,
  onCommand,
  canControl,
  busy,
}: Pick<CapabilityWidgetProps, "capability" | "value" | "onCommand" | "canControl" | "busy">) {
  const checked = value === true;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={cap.name}
            checked={checked}
            disabled={!canControl || busy}
            onChange={(e) => onCommand(cap.id, "set", { value: e.target.checked })}
          />
          <span className="track" />
        </label>
        <span className={`pill ${checked ? "online" : "neutral"}`}>
          {checked ? "ON" : "OFF"}
        </span>
      </div>
      {!canControl && <ReadOnlyHint />}
    </>
  );
}

function EnumActuator({
  capability: cap,
  value,
  onCommand,
  canControl,
  busy,
}: Pick<CapabilityWidgetProps, "capability" | "value" | "onCommand" | "canControl" | "busy">) {
  const [sel, setSel] = useState<string>(typeof value === "string" ? value : "");
  useEffect(() => {
    setSel(typeof value === "string" ? value : "");
  }, [value]);
  const options = cap.enumValues ?? [];
  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          className="select"
          aria-label={cap.name}
          value={sel}
          disabled={!canControl || busy}
          onChange={(e) => {
            setSel(e.target.value);
            void onCommand(cap.id, "set", { value: e.target.value });
          }}
        >
          <option value="" disabled>
            Select…
          </option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      {!canControl && <ReadOnlyHint />}
    </>
  );
}

function SliderActuator({
  capability: cap,
  value,
  onCommand,
  canControl,
  busy,
}: Pick<CapabilityWidgetProps, "capability" | "value" | "onCommand" | "canControl" | "busy">) {
  const min = cap.min ?? 0;
  const max = cap.max ?? 100;
  const step = cap.type === "integer" ? 1 : (max - min) / 100 || 0.1;
  const [draft, setDraft] = useState<number>(
    typeof value === "number" ? clamp(value, min, max) : min,
  );
  useEffect(() => {
    if (typeof value === "number") setDraft(clamp(value, min, max));
  }, [value, min, max]);

  const display = cap.type === "integer" ? Math.round(draft) : draft;
  return (
    <>
      <div className="slider-row">
        <input
          type="range"
          className="slider"
          aria-label={cap.name}
          min={min}
          max={max}
          step={step}
          value={clamp(draft, min, max)}
          disabled={!canControl || busy}
          onChange={(e) => setDraft(clamp(Number(e.target.value), min, max))}
          onPointerUp={() => void onCommand(cap.id, "set", { value: display })}
          onKeyUp={(e) => {
            if (e.key === "Enter") void onCommand(cap.id, "set", { value: display });
          }}
        />
        <span className="slider-val">
          {formatValue(cap, display)}
          {cap.unit ? ` ${cap.unit}` : ""}
        </span>
      </div>
      {!canControl && <ReadOnlyHint />}
    </>
  );
}

function NumericInputActuator({
  capability: cap,
  onCommand,
  canControl,
  busy,
}: Pick<CapabilityWidgetProps, "capability" | "onCommand" | "canControl" | "busy">) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const n = Number(draft);
    if (Number.isNaN(n)) return;
    const v = cap.type === "integer" ? Math.round(n) : n;
    void onCommand(cap.id, "set", { value: clamp(v, cap.min, cap.max) });
  };
  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="number"
          className="input"
          aria-label={cap.name}
          placeholder={cap.unit ? `Value (${cap.unit})` : "Value"}
          value={draft}
          disabled={!canControl || busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn btn-primary btn-sm" disabled={!canControl || busy || draft === ""} onClick={send}>
          Send
        </button>
      </div>
      {!canControl && <ReadOnlyHint />}
    </>
  );
}

function StringActuator({
  capability: cap,
  onCommand,
  canControl,
  busy,
}: Pick<CapabilityWidgetProps, "capability" | "onCommand" | "canControl" | "busy">) {
  const [draft, setDraft] = useState("");
  const send = () => {
    if (!draft) return;
    void onCommand(cap.id, "set", { value: draft });
    setDraft("");
  };
  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          className="input"
          aria-label={cap.name}
          placeholder="Value"
          value={draft}
          disabled={!canControl || busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn btn-primary btn-sm" disabled={!canControl || busy || draft === ""} onClick={send}>
          Send
        </button>
      </div>
      {!canControl && <ReadOnlyHint />}
    </>
  );
}

function ReadOnlyHint() {
  return (
    <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
      View-only — your role cannot send commands.
    </div>
  );
}

/**
 * Render the appropriate widget for a capability.
 *
 * Rules:
 * - kind "status"/"sensor"/"computed", or readOnly, or !canControl → read-only readout
 * - actuator + boolean → toggle switch
 * - actuator + enum → select
 * - actuator + number/integer with min & max → slider
 * - actuator + number/integer without bounds → numeric input + send
 * - actuator + string → text input + send
 */
export function renderCapabilityWidget(
  capability: Capability,
  latestValue: TelemetryValue | undefined,
  onCommand: (
    capabilityId: string,
    action: string,
    params: Record<string, unknown>,
  ) => void | Promise<void>,
  canControl: boolean,
  opts: { series?: { ts: number; value: number }[]; busy?: boolean } = {},
): React.ReactNode {
  const props: CapabilityWidgetProps = {
    capability,
    value: latestValue,
    onCommand,
    canControl,
    series: opts.series,
    busy: opts.busy,
  };
  return <CapabilityWidget {...props} />;
}

export function CapabilityWidget(props: CapabilityWidgetProps) {
  const { capability: cap, value, series, onCommand, canControl, busy } = props;
  const isActuator = cap.kind === "actuator" && cap.readOnly !== true;
  const controllable = canControl && isActuator;

  let body: React.ReactNode;
  if (!controllable) {
    body = <ReadOnlyValue capability={cap} value={value} series={series} />;
  } else if (cap.type === "boolean") {
    body = <BooleanActuator capability={cap} value={value} onCommand={onCommand} canControl={canControl} busy={busy} />;
  } else if (cap.type === "enum") {
    body = <EnumActuator capability={cap} value={value} onCommand={onCommand} canControl={canControl} busy={busy} />;
  } else if ((cap.type === "number" || cap.type === "integer") && cap.min !== undefined && cap.max !== undefined) {
    body = <SliderActuator capability={cap} value={value} onCommand={onCommand} canControl={canControl} busy={busy} />;
  } else if (cap.type === "number" || cap.type === "integer") {
    body = <NumericInputActuator capability={cap} onCommand={onCommand} canControl={canControl} busy={busy} />;
  } else {
    body = <StringActuator capability={cap} onCommand={onCommand} canControl={canControl} busy={busy} />;
  }

  return (
    <WidgetShell
      cap={cap}
      footer={
        cap.readOnly ? (
          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>read-only</div>
        ) : isActuator && !canControl ? (
          <ReadOnlyHint />
        ) : undefined
      }
    >
      {body}
    </WidgetShell>
  );
}
