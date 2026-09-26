/**
 * Device credentials v2: labels, client ids, scopes, last-used tracking.
 *
 * The initial schema only had (username, password_hash) per device credential.
 * This migration adds:
 *  - label: human-readable name ("rooftop sensor", "spare")
 *  - client_id: the MQTT username devices authenticate with
 *    (e.g. `dc_<16 alnum>`); backfilled from `username` for existing rows
 *  - scopes: JSON array of granted capabilities, default ["telemetry","commands"]
 *  - last_used_at: updated by the MQTT broker on successful credential auth
 *
 * Active client_ids stay unique so a revoked credential's id can never be
 * re-issued or collide with a live one.
 */
export const name = "003_device_credentials.sql";

export const sql = `-- WS1: per-device API/MQTT credentials (labels, client ids, scopes).
ALTER TABLE device_credentials ADD COLUMN label TEXT;
ALTER TABLE device_credentials ADD COLUMN client_id TEXT;
ALTER TABLE device_credentials ADD COLUMN scopes TEXT NOT NULL DEFAULT '["telemetry","commands"]';
ALTER TABLE device_credentials ADD COLUMN last_used_at INTEGER;

-- Existing rows were issued under their MQTT username; keep that value as
-- the client id so nothing already deployed changes identity.
UPDATE device_credentials SET client_id = username WHERE client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS device_credentials_client_id_active
  ON device_credentials(client_id) WHERE revoked_at IS NULL;
`;
