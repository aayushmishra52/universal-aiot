/**
 * VirtualDevice — a first-class virtual device speaking the EXACT canonical
 * Universal AIoT protocol: same topics, same schemas as the ESP32 firmware.
 *
 * All device time runs on a VirtualClock: `tick()` advances it by `tickMs`
 * and drives telemetry sampling + heartbeats, so tests can drive the device
 * deterministically with `manualTick: true` and no real timers.
 */
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import {
  PROTOCOL_VERSION,
  DeviceManifestSchema,
  TelemetrySchema,
  CommandSchema,
  CommandResultSchema,
  HealthSchema,
  PresenceSchema,
  DeviceStatusSchema,
  makeMessageId,
  isExpired,
  validateCapabilityValue,
  topicManifest,
  topicStatus,
  topicTelemetry,
  topicCommand,
  topicPresence,
  topicHealth,
  type Command,
  type CommandResultStatus,
  type DeviceStatus,
} from "@aiot/contracts";
import { VirtualClock } from "./clock.js";
import { goldenRoomPreset, type DevicePreset } from "./presets.js";

export interface VirtualDeviceConfig {
  brokerUrl: string;
  orgId: string;
  projectId: string;
  deviceId: string;
  username: string;
  password: string;
  preset?: DevicePreset;
  /** Virtual ms advanced per tick. Default 1000. */
  tickMs?: number;
  clientId?: string;
  /**
   * When true, no automatic tick loop runs: drive the device manually with
   * `tick()` (used by tests for deterministic, timer-free simulation).
   */
  manualTick?: boolean;
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface DeviceTopics {
  manifest: string;
  status: string;
  telemetry: string;
  command: string;
  presence: string;
  health: string;
}

export interface CommandEvent {
  commandId: string;
  capabilityId: string;
  action: string;
  value: unknown;
  status: CommandResultStatus;
}

const SEEN_COMMAND_CAP = 200;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export class VirtualDevice extends EventEmitter {
  /** The device clock. Advance it via `tick()` (or drive it directly). */
  readonly clock = new VirtualClock();

  private readonly cfg: Required<
    Pick<
      VirtualDeviceConfig,
      | "brokerUrl"
      | "orgId"
      | "projectId"
      | "deviceId"
      | "username"
      | "password"
      | "tickMs"
    >
  > &
    VirtualDeviceConfig;
  private readonly preset: DevicePreset;
  private readonly topics: DeviceTopics;

  private client: MqttClient | null = null;
  private connectionState: ConnectionState = "disconnected";
  private pendingConnect: {
    resolve: () => void;
    reject: (err: unknown) => void;
  } | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private loopTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  private readonly bootId = randomBytes(4).toString("hex");
  private readonly bootTimeMs: number;
  private seq = 0;

  private readonly desiredState: Record<string, unknown> = {};
  private readonly reportedState: Record<string, unknown> = {};
  /** LRU commandId -> virtual ms seen, capped at SEEN_COMMAND_CAP. */
  private readonly seenCommandIds = new Map<string, number>();
  private readonly failedSensors = new Set<string>();
  private sensorErrors = 0;
  private readonly executions = new Map<string, number>();
  private fanOn = false;

  private readonly lastSampleAt = new Map<string, number>();
  private lastHeartbeatAt: number;
  private lastTelemetryAt: number | undefined;

  constructor(config: VirtualDeviceConfig) {
    super();
    this.cfg = {
      ...config,
      tickMs: config.tickMs ?? 1000,
    };
    this.preset = config.preset ?? goldenRoomPreset();
    const { orgId, projectId, deviceId } = this.cfg;
    this.topics = {
      manifest: topicManifest(orgId, projectId, deviceId),
      status: topicStatus(orgId, projectId, deviceId),
      telemetry: topicTelemetry(orgId, projectId, deviceId),
      command: topicCommand(orgId, projectId, deviceId),
      presence: topicPresence(orgId, projectId, deviceId),
      health: topicHealth(orgId, projectId, deviceId),
    };
    this.bootTimeMs = this.clock.now();
    this.lastHeartbeatAt = this.clock.now();
  }

  // ------------------------------------------------------------------ state

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getTopics(): DeviceTopics {
    return { ...this.topics };
  }

  /** Desired vs reported state plus the virtual fan hardware state. */
  getState(): {
    desired: Record<string, unknown>;
    reported: Record<string, unknown>;
    fanOn: boolean;
  } {
    return {
      desired: { ...this.desiredState },
      reported: { ...this.reportedState },
      fanOn: this.fanOn,
    };
  }

  /** How many times a capability's actuator was executed (test hook). */
  getExecutionCount(capabilityId: string): number {
    return this.executions.get(capabilityId) ?? 0;
  }

  getSensorErrors(): number {
    return this.sensorErrors;
  }

  // --------------------------------------------------------------- lifecycle

  /**
   * Connect to the broker. Resolves once the device has announced itself:
   * presence online, status REGISTERING -> ONLINE, validated manifest,
   * health, and command subscription.
   */
  async connect(): Promise<void> {
    if (this.client) {
      throw new Error("connect() called while already connected/connecting");
    }
    this.shuttingDown = false;
    this.connectionState = "connecting";
    return new Promise<void>((resolve, reject) => {
      this.pendingConnect = { resolve, reject };
      this.doConnect();
    });
  }

  private doConnect(): void {
    const { brokerUrl, username, password, deviceId } = this.cfg;
    // Never logged: password only ever travels inside the MQTT CONNECT packet.
    const client = mqtt.connect(brokerUrl, {
      protocolVersion: 4,
      username,
      password,
      clientId: this.cfg.clientId ?? deviceId,
      clean: true,
      reconnectPeriod: 0, // manual exponential backoff below
      connectTimeout: 10_000,
      will: {
        topic: this.topics.presence,
        payload: JSON.stringify(
          PresenceSchema.parse({
            protocolVersion: PROTOCOL_VERSION,
            deviceId,
            online: false,
            at: this.clock.now(),
          }),
        ),
        qos: 1,
        retain: false,
      },
    });
    this.client = client;
    client.on("connect", () => {
      void this.handleConnect().catch((err) => this.reportError(err));
    });
    client.on("close", () => this.handleClose());
    client.on("error", (err) => {
      this.reportError(err);
      this.pendingConnect?.reject(err);
      this.pendingConnect = null;
    });
    client.on("message", (topic, payload) => {
      try {
        this.handleMessage(topic, payload);
      } catch (err) {
        this.reportError(err);
      }
    });
  }

  private async handleConnect(): Promise<void> {
    const client = this.client;
    if (!client || this.shuttingDown) return;
    this.connectionState = "connected";
    this.reconnectAttempts = 0;
    this.publishPresence(true);
    this.publishStatus("REGISTERING");
    this.publishStatus("ONLINE");
    this.publishManifest();
    this.publishHealth();
    await new Promise<void>((resolve, reject) => {
      client.subscribe(this.topics.command, { qos: 1 }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    this.startLoop();
    this.emit("connected");
    this.pendingConnect?.resolve();
    this.pendingConnect = null;
  }

  private handleClose(): void {
    if (this.shuttingDown) {
      this.connectionState = "disconnected";
      return;
    }
    this.connectionState = "reconnecting";
    this.stopLoop();
    this.emit("disconnected");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.reconnectTimer) return;
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shuttingDown) return;
      this.doConnect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /** Graceful disconnect: presence offline, then MQTT DISCONNECT. */
  async disconnect(): Promise<void> {
    this.shuttingDown = true;
    this.stopLoop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.client;
    this.client = null;
    if (client && client.connected) {
      this.publishPresence(false);
      // Flush the offline presence before the DISCONNECT packet.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    await new Promise<void>((resolve) => {
      if (client) client.end(false, {}, () => resolve());
      else resolve();
    });
    this.connectionState = "disconnected";
    this.emit("disconnected");
    this.pendingConnect = null;
  }

  // ------------------------------------------------------------ fault injection

  /**
   * Simulate a sensor failure: telemetry for the capability is dropped and
   * reported with quality "error", its capabilityHealth becomes "error", and
   * sensorErrors is incremented once.
   */
  simulateSensorFailure(capabilityId: string, on = true): void {
    const cap = this.preset.capabilities.find((c) => c.id === capabilityId);
    if (!cap) return;
    if (on) {
      if (!this.failedSensors.has(capabilityId)) {
        this.failedSensors.add(capabilityId);
        this.sensorErrors += 1;
      }
    } else {
      this.failedSensors.delete(capabilityId);
    }
  }

  /** Clear injected sensor failures (one capability, or all). */
  clearSensorFailure(capabilityId?: string): void {
    if (capabilityId) this.failedSensors.delete(capabilityId);
    else this.failedSensors.clear();
  }

  /**
   * Force an unclean connection drop: the broker fires the LWT (presence
   * offline) and the device runs its normal exponential-backoff reconnect
   * flow, re-announcing presence + manifest on reconnect.
   */
  simulateDropConnection(): void {
    this.client?.end(true);
  }

  // -------------------------------------------------------------------- tick

  private startLoop(): void {
    if (this.cfg.manualTick || this.loopTimer || this.shuttingDown) return;
    this.loopTimer = setInterval(() => this.tick(), this.cfg.tickMs);
  }

  private stopLoop(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /**
   * Advance the virtual clock by tickMs and do due work: sample sensors whose
   * samplingInterval elapsed and publish telemetry; every 30 virtual seconds
   * publish a presence + health heartbeat.
   */
  tick(): void {
    try {
      this.clock.advance(this.cfg.tickMs);
      if (this.connectionState !== "connected") return;
      this.publishDueTelemetry();
      const now = this.clock.now();
      if (now - this.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        this.lastHeartbeatAt = now;
        this.publishPresence(true);
        this.publishHealth();
      }
    } catch (err) {
      this.reportError(err);
    }
  }

  // ---------------------------------------------------------------- publishes

  /** Fire-and-forget QoS 1 publish. Drops silently when not connected. */
  private send(topic: string, obj: unknown): void {
    const client = this.client;
    if (!client || !client.connected) return;
    client.publish(topic, JSON.stringify(obj), { qos: 1, retain: false });
  }

  private publishPresence(online: boolean): void {
    this.send(
      this.topics.presence,
      PresenceSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        deviceId: this.cfg.deviceId,
        online,
        firmware: this.preset.firmwareVersion,
        at: this.clock.now(),
      }),
    );
  }

  private publishStatus(state: DeviceStatus["state"]): void {
    this.send(
      this.topics.status,
      DeviceStatusSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        deviceId: this.cfg.deviceId,
        state,
        at: this.clock.now(),
      }),
    );
  }

  private publishManifest(): void {
    this.send(
      this.topics.manifest,
      DeviceManifestSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        deviceId: this.cfg.deviceId,
        deviceType: this.preset.deviceType,
        manufacturer: this.preset.manufacturer,
        model: this.preset.model,
        firmwareVersion: this.preset.firmwareVersion,
        capabilities: this.preset.capabilities,
      }),
    );
  }

  private publishHealth(): void {
    const capabilityHealth: Record<string, "good" | "error" | "unknown"> = {};
    for (const cap of this.preset.capabilities) {
      capabilityHealth[cap.id] = this.failedSensors.has(cap.id)
        ? "error"
        : "good";
    }
    this.send(
      this.topics.health,
      HealthSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
        deviceId: this.cfg.deviceId,
        uptime: Math.floor((this.clock.now() - this.bootTimeMs) / 1000),
        mqtt:
          this.connectionState === "connected" ? "connected" : "disconnected",
        firmware: this.preset.firmwareVersion,
        sensorErrors: this.sensorErrors,
        capabilityHealth,
        ...(this.lastTelemetryAt !== undefined
          ? { lastTelemetryAt: this.lastTelemetryAt }
          : {}),
        at: this.clock.now(),
      }),
    );
  }

  private publishDueTelemetry(): void {
    const now = this.clock.now();
    const elapsed = now - this.bootTimeMs;
    const values: Record<string, number | string | boolean> = {};
    let anyFailed = false;
    for (const cap of this.preset.capabilities) {
      if (cap.kind !== "sensor") continue;
      const interval = cap.samplingInterval ?? 2000;
      const last = this.lastSampleAt.get(cap.id) ?? 0;
      if (now - last < interval) continue;
      this.lastSampleAt.set(cap.id, now);
      if (this.failedSensors.has(cap.id)) {
        anyFailed = true;
        continue;
      }
      const engine = this.preset.engines?.[cap.id];
      values[cap.id] = roundTo(engine ? engine(elapsed) : 0, cap.precision ?? 1);
    }
    if (Object.keys(values).length === 0 && !anyFailed) return;
    const sequence = this.seq;
    const telemetry = TelemetrySchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      deviceId: this.cfg.deviceId,
      messageId: makeMessageId(this.cfg.deviceId, this.bootId, sequence),
      timestamp: now,
      timeQuality: "synchronized",
      sequence,
      values,
      quality: anyFailed ? "error" : "good",
    });
    this.seq = sequence + 1;
    this.lastTelemetryAt = now;
    this.send(this.topics.telemetry, telemetry);
    this.emit("telemetry", telemetry);
  }

  // ---------------------------------------------------------------- commands

  private handleMessage(topic: string, payload: Buffer): void {
    if (topic !== this.topics.command) return;
    let data: unknown;
    try {
      data = JSON.parse(payload.toString("utf8"));
    } catch {
      return; // not JSON: ignore
    }
    if (typeof data !== "object" || data === null) return;
    if ((data as { kind?: unknown }).kind === "result") return; // our own results
    const parsed = CommandSchema.safeParse(data);
    if (!parsed.success) return; // malformed command: ignore
    this.handleCommand(parsed.data);
  }

  private handleCommand(cmd: Command): void {
    const now = this.clock.now();
    // (a) expiry
    if (isExpired(cmd, now)) {
      this.publishResult(cmd.commandId, "EXPIRED", "command expired");
      return;
    }
    // (b) duplicate
    if (this.seenCommandIds.has(cmd.commandId)) {
      this.publishResult(cmd.commandId, "DUPLICATE", "duplicate command");
      return;
    }
    this.rememberCommandId(cmd.commandId);
    // (c) capability must exist and be an actuator
    const cap = this.preset.capabilities.find((c) => c.id === cmd.capabilityId);
    if (!cap || cap.kind !== "actuator") {
      this.publishResult(
        cmd.commandId,
        "REJECTED",
        `unknown capability: ${cmd.capabilityId}`,
      );
      return;
    }
    // (d) parameter validation
    const value = (cmd.params as Record<string, unknown> | undefined)?.value;
    const check = validateCapabilityValue(cap, value);
    if (!check.ok) {
      this.publishResult(
        cmd.commandId,
        "FAILED",
        `INVALID_PARAMETER: ${check.reason}`,
      );
      return;
    }
    // (e) execute: desired -> apply to virtual hardware -> reported
    this.desiredState[cap.id] = value;
    this.applyToHardware(cap.id, value);
    this.executions.set(cap.id, (this.executions.get(cap.id) ?? 0) + 1);
    this.publishResult(cmd.commandId, "ACKNOWLEDGED");
    this.reportedState[cap.id] = value;
    this.publishResult(cmd.commandId, "SUCCEEDED", undefined, {
      [cap.id]: value,
    });
    const event: CommandEvent = {
      commandId: cmd.commandId,
      capabilityId: cap.id,
      action: cmd.action,
      value,
      status: "SUCCEEDED",
    };
    this.emit("command", event);
  }

  private applyToHardware(capabilityId: string, value: unknown): void {
    if (capabilityId === "fan") this.fanOn = !!value;
  }

  private publishResult(
    commandId: string,
    status: CommandResultStatus,
    reason?: string,
    reportedState?: Record<string, unknown>,
  ): void {
    this.send(
      this.topics.command,
      CommandResultSchema.parse({
        kind: "result",
        protocolVersion: PROTOCOL_VERSION,
        commandId,
        deviceId: this.cfg.deviceId,
        status,
        ...(reason !== undefined ? { reason } : {}),
        ...(reportedState !== undefined ? { reportedState } : {}),
        at: this.clock.now(),
      }),
    );
  }

  private rememberCommandId(commandId: string): void {
    this.seenCommandIds.delete(commandId);
    this.seenCommandIds.set(commandId, this.clock.now());
    while (this.seenCommandIds.size > SEEN_COMMAND_CAP) {
      const oldest = this.seenCommandIds.keys().next().value;
      if (oldest === undefined) break;
      this.seenCommandIds.delete(oldest);
    }
  }

  private reportError(err: unknown): void {
    if (this.listenerCount("error") > 0) this.emit("error", err);
  }
}
