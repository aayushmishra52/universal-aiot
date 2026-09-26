# Universal AIoT Platform

One integrated platform: an **SDK generator** that scaffolds ESP32 firmware, a
**canonical device protocol** (MQTT topics `aiot/v1/...` + Zod schemas), a
**virtual device** that speaks the exact same protocol for hardware-free
testing, a **backend** (REST API + embedded MQTT broker + realtime WebSocket +
automation engine), and a **React dashboard**.

```
┌─────────────────────────────────────────────────────────────────┐
│                         UNIVERSAL AIOT                          │
├────────────────┬──────────────────────┬─────────────────────────┤
│  ESP32 DEVICE  │   VIRTUAL DEVICE     │        BACKEND          │
│  (firmware     │  (@aiot/virtual-     │  (@aiot/backend)        │
│   from aiot-   │   device)            │  ┌──────────────────┐   │
│   sdk)         │  speaks the SAME     │  │ REST API /api    │   │
│                │  MQTT protocol as    │  │ (Fastify)        │   │
│       MQTT ────┴─────  real hardware  ├──┤ MQTT broker      │   │
│  aiot/v1/{org}/{proj}/{dev}/{kind}   │  │ (embedded aedes) │   │
│   kind: manifest · status · telemetry │  │ WebSocket        │   │
│         · command · presence · health │  │ realtime events  │   │
│                                      │  │ SQLite store     │   │
│                                      │  │ automation engine│   │
│                                      │  └──────────────────┘   │
├────────────────┴──────────────────────┴─────────────────────────┤
│  DASHBOARD (@aiot/dashboard) — Vite+React: device list,         │
│  telemetry charts, commands, automations, WS live updates       │
├─────────────────────────────────────────────────────────────────┤
│  SDK GENERATOR (@aiot/sdk-generator) — `aiot-sdk` CLI: create,  │
│  build (arduino-cli), test (static+compile+protocol+simulator), │
│  simulate, flash, package. CONTRACTS (@aiot/contracts) — the    │
│  canonical protocol every package shares.                       │
└─────────────────────────────────────────────────────────────────┘
```

**Protocol:** every device — real ESP32 or virtual — publishes/consumes the
same topics and validates against the same schemas (`packages/contracts`).
Virtual mode is the default testing mode: no physical hardware required.

## Project tree

```
universal-aiot/
├── apps/
│   ├── backend/            # @aiot/backend — REST API, MQTT broker, WS realtime, automations
│   │   ├── src/            # auth/, mqtt/ (broker+ingest+publish), routes/, rules/, services/
│   │   └── tests/          # vitest suites
│   └── dashboard/          # @aiot/dashboard — Vite+React frontend (dist/ after build)
├── packages/
│   ├── contracts/          # @aiot/contracts — canonical protocol: topics, schemas, validation
│   ├── virtual-device/     # @aiot/virtual-device — bin: aiot-virtual-device
│   └── sdk-generator/      # @aiot/sdk-generator — bin: aiot-sdk
├── tests/
│   └── e2e/                # tests/e2e/run.mjs — headless end-to-end acceptance runner
├── TEST-REPORT.md          # acceptance report (human readable)
├── TEST-REPORT.json        # acceptance report (machine readable)
├── .env.example            # all env vars with defaults
└── package.json            # workspaces: apps/*, packages/*
```

## Quickstart

```bash
cd ~/workspace/universal-aiot

# 1. install (sequential workspace install)
npm install

# 2. build everything
npm run build --workspaces --if-present

# 3. run all workspace test suites
npm test --workspaces --if-present

# 4. run the full end-to-end acceptance (headless, ~20s)
npm run e2e

# 5. dev servers (backend + dashboard concurrently)
npm run dev

# 6. simulate a device without hardware
npm run device:simulate        # aiot-virtual-device --preset golden-room
```

For a real acceptance run on fresh ports, the e2e runner does this itself:

```bash
PORT=4100 MQTT_PORT=11883 WS_PORT=4101 \
DATABASE_URL=file:/tmp/aiot-e2e.db JWT_SECRET=e2e-test-secret \
node tests/e2e/run.mjs
```

It boots the backend, registers a user, creates a project + device, runs a
virtual device through pairing, telemetry, commands, safety checks,
disconnect/reconnect, automations and security checks — then writes
`tests/e2e/report.json` and exits 0 only if every step passes.

## Run commands

| Command | What it does |
|---|---|
| `npm install` | install all workspaces (root, sequential) |
| `npm run build` | `tsc` builds for every workspace (+ `vite build` for dashboard) |
| `npm test` | `vitest run` for every workspace |
| `npm run e2e` | `node tests/e2e/run.mjs` — live acceptance (needs built packages) |
| `npm run dev` | backend (`tsx watch`) + dashboard (`vite`) concurrently |
| `npm run device:simulate` | `aiot-virtual-device --preset golden-room` |
| `npm run build --workspace=@aiot/dashboard` | dashboard production build → `apps/dashboard/dist/` |
| `aiot-virtual-device --help` | all simulator flags (`--broker`, `--org`, `--project`, `--device`, `--username`, `--password`, `--preset`, `--tick`) |
| `aiot-sdk create --help` | scaffold firmware (`--board`, `--device-id`, `--sensor`×, `--actuator`×, …) |
| `aiot-sdk test --project-dir <dir>` | full device test pipeline: static, compile, protocol, simulator |
| `aiot-sdk repair` | install pinned ESP32 core + libraries (needs `arduino-cli` on PATH) |

## Environment variables

Copy `.env.example` to `.env`. Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | backend HTTP port (`/api`) |
| `MQTT_PORT` | `1883` | embedded MQTT broker port |
| `WS_PORT` | `4001` | realtime WebSocket port |
| `HTTP_HOST` | `127.0.0.1` | API/WS bind host — set `0.0.0.0` to expose on all interfaces |
| `MQTT_HOST` | `127.0.0.1` | broker bind host — set `0.0.0.0` for remote devices |
| `PUBLIC_MQTT_URL` | derived | URL advertised to dashboard/SDK for devices (e.g. `mqtts://broker.example.com:8883`) |
| `PUBLIC_API_URL` | derived | URL advertised to dashboard/SDK for the API |
| `MQTT_TLS_PORT` / `MQTT_TLS_KEY` / `MQTT_TLS_CERT` | `8883` | broker TLS listener (enabled only when key + cert are both set) |
| `TLS_KEY` / `TLS_CERT` | — | HTTPS for the API (enabled only when both are set) |
| `FIREBASE_PROJECT_ID` | — | enables optional Firebase Auth (`POST /api/auth/firebase`); see `docs/FIREBASE-AUTH.md` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | — | service-account JSON for `firebase-admin` (or use Application Default Credentials) |
| `DATABASE_URL` | `file:./data/aiot.db` | SQLite database (`file:` prefix + path) |
| `JWT_SECRET` | *(required)* | JWT signing secret — backend **refuses to boot** without it |
| `JWT_EXPIRES_IN` | `12h` | token lifetime |
| `RATE_LIMIT_AUTH_PER_MIN` | `30` | strict limiter for `/auth/*` + `/pair` (per IP) |
| `RATE_LIMIT_GLOBAL_PER_MIN` | `600` | limiter for all other routes |
| `SWEEP_INTERVAL_MS` | `10000` | command-expiry sweeper interval |
| `PAIRING_TTL_HOURS` | `24` | pairing credential lifetime |
| `VITE_API_URL` | `http://localhost:4000` | dashboard → backend (build-time) |
| `VITE_WS_URL` | `ws://localhost:4001` | dashboard → realtime (build-time) |

## Pairing flow

1. `POST /api/projects/:projectId/devices` (owner) →
   `{ device: { deviceId: "DEV-XXXXX" }, pairing: { username, password } }`.
   The password is **shown once**; only its bcrypt hash is stored.
2. The device (or `aiot-virtual-device`) connects to MQTT with
   `username` / `password` and publishes its manifest + telemetry.
3. A user (or onboarding app) calls `POST /api/pair`
   `{ deviceId, username, password }` with a Bearer token →
   `{ ok: true, rotated: true, deviceToken }`. The pairing row is marked used,
   all previous device credentials are revoked — the old password stops
   working immediately.
4. The device reconnects with the **same username** and the **new
   `deviceToken`** as its MQTT password.

MQTT auth: broker credentials are checked per-connect against
`device_credentials` (bcrypt); pairing credentials are checked against the
`pairings` table only during pairing.

## Device credentials & remote access

Per-device MQTT login credentials so a device can connect from anywhere:

```bash
# Issue (ADMIN only) — the secret is returned ONCE, only its bcrypt hash is stored
curl -X POST $API/api/devices/DEV-XXXX/credentials \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"label":"field unit","scopes":["telemetry","commands"]}'
# -> {id, clientId, secret, label, scopes, createdAt}

curl -H "Authorization: Bearer $TOKEN" $API/api/devices/DEV-XXXX/credentials
# -> [{id, clientId, label, scopes, createdAt, lastUsedAt, revokedAt}]  (never secrets)

curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  $API/api/devices/DEV-XXXX/credentials/<credId>   # revoke
```

Or use the SDK (see the `aiot-sdk` repo):

```bash
aiot-sdk login
aiot-sdk devices
aiot-sdk provision --device DEV-XXXX --out ./aiot.credentials.env
aiot-sdk init --credentials-file ./aiot.credentials.env --project-dir ./fw
```

The dashboard Devices page has a "Credentials" button per device: provision,
copy the one-time secret, download it as `.env`/JSON, and revoke old ones.
`GET /api/devices/:id` returns `connectivity: {mqttUrl, apiUrl}` built from
`PUBLIC_MQTT_URL` / `PUBLIC_API_URL`.

To reach devices outside your LAN: set `HTTP_HOST`/`MQTT_HOST=0.0.0.0`, put the
backend on a VPS (or Render/Railway/Fly.io free tier), set
`PUBLIC_MQTT_URL`/`PUBLIC_API_URL` to the public addresses, and optionally
enable TLS (`MQTT_TLS_KEY`/`MQTT_TLS_CERT`, `TLS_KEY`/`TLS_CERT`). You can
also point `PUBLIC_MQTT_URL` at a free managed broker (HiveMQ Cloud / EMQX
Cloud free tier) instead of the embedded aedes broker. Full checklist:
`docs/SELF-HOSTING.md`; credential details: `docs/DEVICE-CREDENTIALS.md`.

## Firebase auth (optional)

Local email/password auth (JWT + SQLite) is the default and needs no setup.
To offer Firebase sign-in instead, set `FIREBASE_PROJECT_ID` on the backend
(then `npm install firebase-admin` in `apps/backend` — it's an
`optionalDependency`, loaded lazily only when enabled) and provide
`FIREBASE_SERVICE_ACCOUNT_JSON` or Application Default Credentials. The
dashboard then shows "Continue with Firebase" (advertised via
`GET /api/meta` → `{ok, time, firebaseAuth}`) with email/password sign-in
through the Firebase Auth REST API — no Firebase JS SDK in the bundle. The
SDK also accepts a Firebase ID token: `aiot-sdk login --token <idToken>`.
Free-tier setup: `docs/FIREBASE-AUTH.md` (Firebase Spark plan — no paid
service).

## Self-hosting minimums

**Node 20+**, **512 MB RAM** (backend idles at ~96 MB measured), **~250 MB
disk**. No Docker or Postgres required — SQLite + embedded MQTT broker are
the defaults. One-command production start:

```bash
npm run build
# set JWT_SECRET in .env (required), then:
npm run start                                # API :4000, MQTT :1883, WS :4001
# serve apps/dashboard/dist with any static server (SPA: fall back to index.html)
```

See `docs/SELF-HOSTING.md` for VPS deploy, free-tier options, TLS, and the
connect-from-anywhere checklist; `docs/PERFORMANCE.md` for measured numbers.

## Key API endpoints

```
POST /api/auth/register            {email, password, name} -> {token, user, org}
POST /api/auth/login               -> {token, user, orgs}
POST /api/auth/firebase            {idToken} -> {token, user, orgs}  (optional, 501 when disabled)
GET  /api/meta                     -> {ok, time, firebaseAuth}
POST /api/orgs/:orgId/members      {email, role: OWNER|ADMIN|VIEWER}
POST /api/orgs/:orgId/projects     {name} -> {project}
POST /api/projects/:projectId/devices   {name, type, model} -> {device, pairing}
POST /api/devices/:deviceId/credentials {label?, scopes?} -> {id, clientId, secret (once)}
GET  /api/devices/:deviceId/credentials -> [credential metadata]
DELETE /api/devices/:deviceId/credentials/:credId   (revoke)
POST /api/pair                     {deviceId, username, password} -> {ok, rotated, deviceToken}
GET  /api/devices/:deviceId        -> {device, capabilities, state, health}
GET  /api/devices/:deviceId/telemetry?limit=N
POST /api/devices/:deviceId/commands    {capabilityId, action, params, ttlMs}
GET  /api/devices/:deviceId/commands?limit=N
POST /api/projects/:projectId/automations {name, deviceId?, enabled, condition, action}
WS   ws://host:WS_PORT             {"type":"auth","token"} then {"type":"subscribe","projectId"}
                                   -> {"type":"event","event":{kind:"device.telemetry"|"device.online"|"device.offline"|"command.acknowledged"|..., projectId, deviceId, at, data}}
```

## Security notes

- **Credential rotation:** pairing is one-time; on success the old pairing
  password is dead and a fresh `deviceToken` is issued. Unknown/used/expired
  pairings return 404 to avoid credential enumeration.
- **Authz:** org roles `OWNER`/`ADMIN`/`VIEWER`. Device + command writes need
  `ADMIN`; viewers get 403. Non-members get 404 (no resource existence leaks).
- **Command safety:** capability must exist and be an actuator; params are
  validated against the capability type (`invalid_parameter` → 400); commands
  carry `issuedAt`/`expiresAt` and devices **must not** execute expired
  commands (they publish an `EXPIRED` result instead).
- **Rate limiting:** strict 30 req/min/IP on auth + pairing; 600 req/min global.
- **Secrets hygiene:** pairing passwords and device tokens are shown once and
  stored bcrypt-hashed; MQTT/WiFi secrets go to the gitignored `config.h` in
  generated firmware; `aiot-sdk test` runs a secret scan as a publish gate.
- JWTs expire (`JWT_EXPIRES_IN`, default 12h); the backend refuses to start
  without `JWT_SECRET`.

## Limitations

- **Virtual mode is the default test mode** — the e2e suite, the SDK simulator
  test, and `npm run device:simulate` exercise the protocol without hardware.
  `aiot-sdk test` reports `HARDWARE_SMOKE_TEST: not_run`; flash real hardware
  and follow each project's `TESTING.md` before shipping.
- Single-node SQLite storage (better-sqlite3); no horizontal scaling story.
- The embedded MQTT broker (aedes) is in-process — fine for development and
  testing, not a substitute for a managed broker at fleet scale.
- Real firmware compile requires `arduino-cli` on PATH plus the ESP32 core and
  libraries (`aiot-sdk repair` installs the pinned set).
- **No telemetry retention/pruning** — telemetry accumulates unbounded in
  SQLite; prune old rows manually (`DELETE FROM telemetry WHERE ts < ?`) or
  back up and rotate the DB file (see `docs/SELF-HOSTING.md`).
- Dashboard Overview KPIs are computed client-side from existing endpoints
  (telemetry rate is sampled; fleet uptime % has no aggregation endpoint yet).

## Test reports

- [TEST-REPORT.md](./TEST-REPORT.md) — latest full acceptance run (all green)
- [TEST-REPORT.json](./TEST-REPORT.json) — same, machine readable
