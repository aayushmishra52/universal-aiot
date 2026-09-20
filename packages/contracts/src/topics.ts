/**
 * Canonical MQTT topic scheme for the Universal AIoT platform (protocol v1).
 *
 * Every topic has the shape:
 *   aiot/v1/{orgId}/{projectId}/{deviceId}/{kind}
 * where kind is one of: manifest, status, telemetry, command, presence, health.
 */

/** Canonical protocol version implemented by this package. */
export const PROTOCOL_VERSION = "1.0" as const;

/** The leaf topic kinds defined by the protocol. */
export type TopicKind =
  | "manifest"
  | "status"
  | "telemetry"
  | "command"
  | "presence"
  | "health";

/** Topic prefix: aiot/v1/{orgId}/{projectId}/{deviceId} */
export function topicRoot(
  orgId: string,
  projectId: string,
  deviceId: string,
): string {
  return `aiot/v1/${orgId}/${projectId}/${deviceId}`;
}

/** Device capability manifest (retained). */
export function topicManifest(
  orgId: string,
  projectId: string,
  deviceId: string,
): string {
  return `${topicRoot(orgId, projectId, deviceId)}/manifest`;
}

/** Device lifecycle status. */
export function topicStatus(
  orgId: string,
  projectId: string,
  deviceId: string,
): string {
  return `${topicRoot(orgId, projectId, deviceId)}/status`;
}

/** Sensor/actuator telemetry readings. */
export function topicTelemetry(
  orgId: string,
  projectId: string,
  deviceId: string,
): string {
  return `${topicRoot(orgId, projectId, deviceId)}/telemetry`;
}

/** Commands issued to the device (and command results back). */
export function topicCommand(
  orgId: string,
  projectId: string,
  deviceId: string,
): string {
  return `${topicRoot(orgId, projectId, deviceId)}/command`;
}

/** Online/offline presence announcements. */
export function topicPresence(
  orgId: string,
  projectId: string,
  deviceId: string,
): string {
  return `${topicRoot(orgId, projectId, deviceId)}/presence`;
}

/** Device health snapshots. */
export function topicHealth(
  orgId: string,
  projectId: string,
  deviceId: string,
): string {
  return `${topicRoot(orgId, projectId, deviceId)}/health`;
}

const TOPIC_REGEX =
  /^aiot\/v1\/([^/]+)\/([^/]+)\/([^/]+)\/(manifest|status|telemetry|command|presence|health)$/;

export interface ParsedTopic {
  orgId: string;
  projectId: string;
  deviceId: string;
  kind: TopicKind;
}

/**
 * Parse an MQTT topic into its components.
 * Returns null when the topic does not match the canonical scheme.
 */
export function parseTopic(topic: string): ParsedTopic | null {
  const match = TOPIC_REGEX.exec(topic);
  if (!match) return null;
  return {
    orgId: match[1],
    projectId: match[2],
    deviceId: match[3],
    kind: match[4] as TopicKind,
  };
}
