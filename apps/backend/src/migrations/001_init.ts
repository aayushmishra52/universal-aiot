/**
 * Initial schema migration.
 *
 * The SQL lives in this module (rather than a .sql file) so the required
 * build (`tsc -p tsconfig.json`) bundles it into dist without extra copy
 * steps: migrations resolve identically under tsx, tests, and node dist/.
 */
export const name = "001_init.sql";

export const sql = `-- Universal AIoT backend schema (better-sqlite3, WAL mode).
-- All timestamps are integer milliseconds since epoch.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  model TEXT,
  firmware_version TEXT,
  protocol_version TEXT,
  status TEXT NOT NULL DEFAULT 'OFFLINE',
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_credentials (
  id TEXT PRIMARY KEY,
  device_id_fk TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
-- Usernames are unique among *active* credentials so rotation can revoke the
-- old row and insert a new one under the same username.
CREATE UNIQUE INDEX IF NOT EXISTS device_credentials_username_active
  ON device_credentials(username) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS pairings (
  id TEXT PRIMARY KEY,
  device_id_fk TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pairings_device_username
  ON pairings(device_id_fk, username);

CREATE TABLE IF NOT EXISTS capabilities (
  device_id_fk TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  kind TEXT NOT NULL,
  unit TEXT,
  min REAL,
  max REAL,
  precision INTEGER,
  sampling_interval INTEGER,
  read_only INTEGER NOT NULL DEFAULT 0,
  enum_values TEXT,
  category TEXT,
  PRIMARY KEY (device_id_fk, capability_id)
);

CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id_fk TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  values_json TEXT NOT NULL,
  quality TEXT
);
CREATE INDEX IF NOT EXISTS telemetry_device_ts
  ON telemetry(device_id_fk, ts DESC);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE,
  device_id_fk TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  action TEXT NOT NULL,
  params_json TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS commands_device
  ON commands(device_id_fk, issued_at DESC);

CREATE TABLE IF NOT EXISTS command_results (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE REFERENCES commands(command_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reason TEXT,
  reported_state_json TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_state (
  device_id_fk TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  desired_json TEXT NOT NULL DEFAULT '{}',
  reported_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_health (
  device_id_fk TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  uptime INTEGER,
  free_heap INTEGER,
  wifi_rssi INTEGER,
  mqtt TEXT,
  firmware TEXT,
  sensor_errors INTEGER,
  capability_health_json TEXT,
  last_telemetry_at INTEGER,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices(device_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  condition_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  last_triggered INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS automation_runs_automation
  ON automation_runs(automation_id, at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at DESC);
`;
