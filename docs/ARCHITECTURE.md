# Architecture

Universal AIoT is a monorepo of npm workspaces sharing **one canonical
device protocol**. Everything a device does — real ESP32 firmware or the
virtual device — goes through the protocol in `packages/contracts`, and the
backend is the single source of truth for devices, telemetry, state, and
automation.

## Layers

```
┌────────────────────────────┐
│  DEVICE LAYER              │  ESP32 firmware (built by the aiot-sdk CLI,
│  firmware / virtual device │  separate repo: github.com/<your-username>/aiot-sdk)
│                            │  or @aiot/virtual-device — both speak the
│                            │  SAME protocol: identical topics + schemas
└─────────────┬──────────────┘
              │ MQTT  (aiot/v1/{org}/{proj}/{dev}/{kind})
              ▼
┌────────────────────────────┐
│  TRANSPORT: BACKEND        │  apps/backend
│  ├─ MQTT broker (aedes)    │  embedded broker; devices authenticate with
│  │                         │  bcrypt-verified pairing or device credentials
│  ├─ ingest                 │  validates every message against Zod schemas
│  │                         │  from @aiot/contracts; writes SQLite; evaluates
│  │                         │  automation rules
│  ├─ publish                │  issues commands to devices on command topics
│  ├─ REST API (Fastify)     │  /api — users, orgs, projects, devices, pairing,
│  │                         │  commands, telemetry, automations
│  ├─ WebSocket realtime     │  per-project event fan-out to the dashboard
│  └─ SQLite store           │  users, orgs, projects, devices, credentials,
│                            │  telemetry, state, health, commands, automations
└─────────────┬──────────────┘
              │ HTTP /api  +  WS events
              ▼
┌────────────────────────────┐
│  PRESENTATION: DASHBOARD   │  apps/dashboard — Vite + React SPA
│                            │  device management, telemetry charts, commands,
│                            │  pairing UI, automations, live WS updates
└────────────────────────────┘

┌────────────────────────────┐
│  SHARED: @aiot/contracts   │  packages/contracts — topic builders, Zod
│                            │  schemas (manifest, telemetry, command, status,
│                            │  presence, health, automation, realtime events),
│                            │  validation helpers. Imported by backend,
│                            │  virtual-device, and the aiot-sdk firmware
│                            │  templates. The protocol is the contract.
└────────────────────────────┘
```

## Protocol

Every device communicates on topics shaped

```
aiot/v1/{orgId}/{projectId}/{deviceId}/{kind}
```

with `kind ∈ manifest · status · telemetry · command · presence · health`
(protocol v1, `PROTOCOL_VERSION = "1.0"` in `@aiot/contracts`).

- **manifest** (retained): device capability manifest — sensors/actuators
  with units, ranges, enum values, read-only flags. Published once (and on
  reconnect); the backend populates the `capabilities` table from it.
- **status**: lifecycle status (ONLINE/OFFLINE transitions).
- **telemetry**: sensor readings. Ingest validates the schema, stores rows,
  updates last-seen, and runs the automation rules engine.
- **command**: bidirectional. Backend → device carries command requests
  (`capabilityId`, `action`, `params`, TTL); device → backend carries
  results (status: PENDING/SUCCEEDED/FAILED/EXPIRED).
- **presence**: retained online/offline presence (LWT semantics).
- **health**: periodic health report (uptime, RSSI, heap, etc.), stored and
  served via `GET /devices/:deviceId/health`.

All schemas live in `packages/contracts/src/*.ts` and are validated on
ingest; malformed payloads are rejected and never stored.

## Backend internals

```
src/
├── index.ts / server.ts   boot: loadConfig → migrations → broker → realtime → routes
├── config.ts              env parsing; JWT_SECRET is REQUIRED (boot fails without it)
├── db.ts                  better-sqlite3 connection
├── migrations/            schema versioning (001_init: users, orgs, memberships,
│                          projects, devices, capabilities, device_state,
│                          device_health, telemetry, pairings,
│                          device_credentials, commands, automations,
│                          automation_runs, audit)
├── auth/                  bcrypt passwords, JWT issue/verify, Fastify auth hook
├── authz.ts               org/project/device access + roles (OWNER/ADMIN/MEMBER)
├── routes/               Fastify route modules: auth, orgs, devices, pairing,
│                          commands, automations, meta (health)
├── mqtt/
│   ├── broker.ts          aedes broker + bcrypt credential auth
│   │                      (pairing credential OR active device credential)
│   ├── ingest.ts          topic routing → schema validation → SQLite writes
│   │                      → rules engine → realtime broadcast
│   └── publish.ts         command dispatch to device command topics
├── rules/engine.ts        automation evaluation on telemetry
├── realtime.ts            ws server: {type:"auth", token} within 5s, then
│                          {type:"subscribe", projectId}; broadcasts
│                          {type:"event", event} to subscribed sockets
└── services/
    ├── commands.ts        sendCommand(): validates capability, writes command
    │                      row (TTL), publishes to MQTT
    ├── sweeper.ts         periodic job (SWEEP_INTERVAL_MS): expires stale
    │                      commands, flips OFFLINE devices
    └── audit.ts           audit log for security-relevant actions
```

## Data flow examples

**Telemetry → dashboard:**
device publishes `…/telemetry` → broker authenticates → ingest validates
(Zod) → SQLite insert + last-seen update → rules engine evaluates automations
→ `broadcastRealtime` fans out to dashboard sockets subscribed to the
project → charts update live.

**Command:**
dashboard `POST /api/devices/:id/commands` (ADMIN) → `sendCommand()` stores
PENDING command with TTL → publishes to `…/command` → device executes →
device publishes result on `…/command` → ingest marks SUCCEEDED/FAILED →
realtime event to dashboard; sweeper expires commands past TTL.

**Pairing:** see [docs/PAIRING.md](PAIRING.md).

## Tenancy

Everything hangs under `orgs → projects → devices`. Roles are `OWNER`,
`ADMIN`, `MEMBER`. Device mutations (create, rotate, delete) and command
issuing require ADMIN or above; reads require membership. Pairing endpoints
return 404 (not 401/403) for unknown/used/expired credentials to avoid
enumeration.

## Scaling notes

The backend is a single process by design: SQLite + embedded broker. For
production, run one process per deployment (fly.io / VPS), put TLS in front
(reverse proxy), and point `DATABASE_URL` at durable storage. Multi-instance
horizontal scaling would require moving MQTT and realtime fan-out to shared
infrastructure — out of scope for v1.
