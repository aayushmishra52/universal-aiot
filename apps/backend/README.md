# @aiot/backend

Universal AIoT platform backend: REST API (Fastify 5), embedded MQTT broker
(aedes), realtime WebSocket fan-out, SQLite persistence (better-sqlite3, WAL),
an automation engine, and a command-expiry sweeper. All protocol topics,
schemas, and types come from `@aiot/contracts` — nothing is duplicated here.

## Run

```bash
# from the repository root
npm install
npm run build --workspace=@aiot/backend
npm test  --workspace=@aiot/backend

# dev (tsx watch)
npm run dev --workspace=@aiot/backend

# production (after build)
npm start --workspace=@aiot/backend
```

Requirements: Node >= 22, `JWT_SECRET` set (see `.env.example` at the repo
root). Default ports: HTTP API `4000`, MQTT `1883`, WebSocket `4001`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | _(required)_ | HS256 signing secret; the process refuses to boot without it |
| `DATABASE_URL` | `file:./data/aiot.db` | SQLite file (`file:` prefix optional) |
| `PORT` | `4000` | HTTP API port |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `WS_PORT` | `4001` | Realtime WebSocket port |
| `JWT_EXPIRES_IN` | `12h` | JWT lifetime |
| `RATE_LIMIT_AUTH_PER_MIN` | `30` | Strict per-IP limit for auth/pairing endpoints |
| `RATE_LIMIT_GLOBAL_PER_MIN` | `600` | Global per-IP limit |
| `SWEEP_INTERVAL_MS` | `10000` | Command-expiry sweeper interval |
| `PAIRING_TTL_HOURS` | `24` | One-time pairing credential lifetime |

## REST API (`/api`)

Auth: `POST /auth/register`, `POST /auth/login` (strict rate limit),
`GET /auth/me`. Bearer JWT on everything else.

- **Orgs:** `POST /orgs`, `GET /orgs`, `POST /orgs/:orgId/members`,
  `GET|POST /orgs/:orgId/projects`
- **Devices:** `POST /projects/:projectId/devices`,
  `GET /projects/:projectId/devices`, `GET|DELETE /devices/:deviceId`,
  `POST /devices/:deviceId/credentials/rotate`,
  `GET /devices/:deviceId/telemetry`, `GET /devices/:deviceId/state`,
  `GET /devices/:deviceId/health`, `GET /devices/:deviceId/events`
- **Pairing:** `POST /pair` — exchanges a one-time pairing credential for a
  device token. Pairing credentials are single-use, expire, and are
  rate-limited aggressively.
- **Commands:** `POST|GET /devices/:deviceId/commands` — validated against
  the device manifest (`validateCapabilityValue`); published over MQTT QoS 1
  with an expiry. Results flow back over MQTT.
- **Automations:** `GET|POST /projects/:projectId/automations`,
  `GET|PUT|DELETE /projects/:projectId/automations/:automationId`,
  `GET .../runs`
- **Meta:** `GET /health`

Authorization: every device/telemetry/command/config endpoint checks org
membership (`OWNER > ADMIN > VIEWER`). Non-members get `404` (no existence
leak); insufficient role gets `403`.

## MQTT

Devices connect with either an unused, unexpired pairing credential or an
active device credential (both bcrypt-verified; failures are logged without
the secret). A device may publish only under its own topic root
(`aiot/v1/{org}/{project}/{device}/…`) and subscribe only to its own
`…/command` topic. All payloads are validated with `@aiot/contracts`
schemas; malformed payloads are ignored, never crash the broker.

## Realtime WebSocket

Connect to `ws://host:4001`. The first message must be
`{type:"auth", token}` within 5 seconds, then
`{type:"subscribe", projectId}` (membership verified). Events arrive as
`{type:"event", event}`: `device.online/offline/telemetry/state_changed/
health`, `command.created/acknowledged/failed`, `automation.triggered`.

## Automation engine & sweeper

Automations (`condition` on telemetry/state, `action` issuing a command)
evaluate on every ingested telemetry/state result, with a 60s per-automation
cooldown and a run history. The sweeper marks unacknowledged commands
`EXPIRED` past their expiry and emits `command.failed`.

## Security notes

- Passwords and device/pairing secrets are stored as bcrypt hashes only;
  tokens are shown once at issuance and never logged.
- No plaintext secrets in the database, logs, or git.
- Auth and pairing endpoints carry an aggressive configurable rate limit.
- Device deletion revokes credentials/pairings and cascades device data.

## Layout

```
src/
  index.ts            process entrypoint
  server.ts           composition root (HTTP + MQTT + WS + sweeper)
  config.ts           env config (JWT_SECRET required)
  db.ts               SQLite open/WAL + bundled migrations
  migrations/         versioned schema (bundled TS modules so `tsc` alone ships them)
  auth/               bcrypt passwords, JWT, Fastify auth middleware
  authz.ts            org/project/device access (404/403 semantics)
  routes/             one module per resource
  mqtt/               broker (auth/ACL), ingest pipeline, command publish
  rules/engine.ts     automation evaluation
  services/           audit log, command issuing, expiry sweeper
  realtime.ts         WebSocket fan-out
tests/                vitest suite (45 tests, isolated ephemeral servers)
```

Database migrations live in `src/migrations/` as TypeScript modules
exporting SQL strings, applied in order and tracked in `schema_migrations`.
They are bundled by `tsc` so no copy step is needed for `node dist/index.js`.
