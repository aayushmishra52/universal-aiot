# Universal AIoT Platform

An end-to-end IoT platform on one canonical device protocol: a **canonical
protocol layer** (MQTT topics `aiot/v1/...` + Zod schemas), a **virtual
device** that speaks the exact same protocol as real firmware, a **backend**
(REST API + embedded MQTT broker + realtime WebSocket + automation engine),
and a **React dashboard**. Virtual mode is the default testing mode — no
physical ESP32 hardware required.

Firmware for real ESP32 devices is scaffolded by the **`aiot-sdk` CLI**,
which lives in its own repo:
**[github.com/\<your-username\>/aiot-sdk](https://github.com/<your-username>/aiot-sdk)**
and generates firmware against this platform's protocol.

```
┌──────────────────────────────────────────────────────────────────┐
│                        UNIVERSAL AIOT                            │
│                                                                  │
│   ┌──────────────┐   ┌──────────────────┐   ┌─────────────────┐   │
│   │  ESP32       │   │  VIRTUAL DEVICE  │   │  BACKEND        │   │
│   │  (firmware   │   │  (@aiot/virtual- │   │  (@aiot/backend)│   │
│   │  from the    │   │  device)         │   │  ┌───────────┐  │   │
│   │  aiot-sdk    │   │  speaks the SAME │   │  │ REST API  │  │   │
│   │  CLI —       │   │  MQTT protocol   │   │  │  /api     │  │   │
│   │  separate    │   │  as real         │   │  ├───────────┤  │   │
│   │  repo)       │   │  hardware        │   │  │ MQTT      │  │   │
│   └──────┬───────┘   └────────┬─────────┘   │  │ broker    │  │   │
│          │  MQTT              │  MQTT       │  │ (aedes)   │  │   │
│          └────────────────────┴─────────────┤  ├───────────┤  │   │
│       aiot/v1/{org}/{proj}/{dev}/{kind}     │  │ WebSocket │  │   │
│       kind: manifest · status · telemetry   │  │ realtime  │  │   │
│             · command · presence · health   │  ├───────────┤  │   │
│                                             │  │ SQLite    │  │   │
│                                             │  │ store     │  │   │
│                                             │  ├───────────┤  │   │
│                                             │  │ automation│  │   │
│                                             │  │ engine    │  │   │
│                                             │  └───────────┘  │   │
│                                             └─────────────────┘   │
│                                                                  │
│   DASHBOARD (@aiot/dashboard) — Vite+React: devices, telemetry   │
│   charts, commands, pairing, automations, live WS updates        │
│                                                                  │
│   CONTRACTS (@aiot/contracts) — the canonical protocol every     │
│   package shares (topics, Zod schemas, validation)              │
└──────────────────────────────────────────────────────────────────┘
```

## Quickstart

```bash
cd ~/workspace/release/universal-aiot

# 1. install all workspaces (node >= 22 required)
npm install

# 2. copy env and set a real JWT secret
cp .env.example .env   # then edit JWT_SECRET

# 3. build everything
npm run build --workspaces --if-present

# 4. run all workspace test suites
npm test

# 5. run the headless end-to-end acceptance (boots backend + virtual device)
npm run e2e

# 6. dev servers: backend (tsx watch) + dashboard (vite), concurrently
npm run dev

# 7. simulate a device without hardware
npm run device:simulate        # aiot-virtual-device --preset golden-room
```

The dashboard opens at `http://localhost:5173` (Vite default) and talks to
the backend at `http://localhost:4000` via the `/api` prefix.

## Dashboard tour

- **Login / Register** — JWT auth; a new user gets their own org as OWNER.
- **Devices** — per-project device list with status (ONLINE/OFFLINE),
  last-seen, capability counts.
- **Device detail** — telemetry charts, desired/reported state, health
  (from the device's `health` topic), capability list.
- **Pair device** — shows the one-time pairing credentials (deviceId +
  pairing username + password) generated when the device was created.
- **Commands** — issue capability commands (e.g. `fan=set`) with TTL; the
  backend tracks command status through to the device's result.
- **Automations** — threshold rules (`capability op value` → action) with
  run history; the backend rules engine evaluates on each telemetry ingest.
- **Settings** — org members, API URL config.

## Pairing flow

Pairing binds a physical (or virtual) device to a backend device record:

1. Create the device (`POST /api/projects/:projectId/devices`) as a project
   ADMIN. The response includes a **one-time pairing credential**, shown
   **once**: `{ deviceId, username, password }`.
2. The device connects to the MQTT broker (`mqtt://host:1883`) using those
   credentials. The broker authenticates with bcrypt — either the pairing
   credential (unused, unexpired, unrevoked) or an active device credential.
3. The device (or dashboard on its behalf) calls `POST /api/pair` with
   `{ deviceId, username, password }`. The pairing row is marked **used**,
   any previous device credential is **revoked**, and a fresh 32-char device
   token is issued (shown once) for subsequent MQTT authentication.
4. Pairing credentials expire after `PAIRING_TTL_HOURS` (default 24) and can
   be revoked at any time (`POST /devices/:deviceId/credentials/rotate`
   issues a fresh device token; `DELETE /devices/:deviceId` revokes
   everything).

Full lifecycle details: [docs/PAIRING.md](docs/PAIRING.md).

## API overview

Base path: `/api`. All routes except `/health`, `/auth/register`,
`/auth/login` require `Authorization: Bearer <JWT>`.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | create user (+ personal org) |
| POST | `/auth/login` | get JWT |
| GET | `/auth/me` | current user |
| POST/GET | `/orgs` | create / list orgs |
| POST | `/orgs/:orgId/members` | add member (ADMIN) |
| GET/POST | `/orgs/:orgId/projects` | list / create projects |
| GET/POST | `/projects/:projectId/devices` | list / create device (create returns one-time pairing credential) |
| GET/DELETE | `/devices/:deviceId` | device detail (+capabilities, state, health) / delete (ADMIN) |
| POST | `/devices/:deviceId/credentials/rotate` | rotate device token (ADMIN) |
| GET | `/devices/:deviceId/telemetry` | history (`?capability=&from=&to=&limit=`) |
| GET | `/devices/:deviceId/state` | desired/reported state |
| GET | `/devices/:deviceId/events` | audit/event feed |
| GET | `/devices/:deviceId/health` | last health report |
| POST | `/pair` | pair device with pairing credential |
| POST/GET | `/devices/:deviceId/commands` | send command / list commands |
| GET/POST/PUT/DELETE | `/projects/:projectId/automations…` | CRUD automations |
| GET | `/projects/:projectId/automations/:id/runs` | automation run history |
| GET | `/health` | backend health |

Full reference: [docs/API.md](docs/API.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Device protocol (topics + schemas): `packages/contracts`.

## Environment variables

Copy `.env.example` → `.env`. Never commit `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | backend HTTP port (`/api`) |
| `MQTT_PORT` | `1883` | embedded MQTT broker port |
| `WS_PORT` | `4001` | realtime WebSocket port |
| `DATABASE_URL` | `file:./data/aiot.db` | SQLite database path |
| `JWT_SECRET` | *(required)* | JWT signing secret — **the backend refuses to boot without it** |
| `JWT_EXPIRES_IN` | `12h` | JWT lifetime |
| `RATE_LIMIT_AUTH_PER_MIN` | `30` | strict limiter for auth/pair routes |
| `RATE_LIMIT_GLOBAL_PER_MIN` | `600` | global rate limit |
| `SWEEP_INTERVAL_MS` | `10000` | command-expiry sweeper cadence |
| `PAIRING_TTL_HOURS` | `24` | pairing credential lifetime |
| `VITE_API_URL` | `http://localhost:4000` | backend URL for the dashboard |
| `VITE_WS_URL` | `ws://localhost:4001` | WS URL for the dashboard |

## Testing

```bash
npm test            # vitest for every workspace: contracts, backend, virtual-device, dashboard
npm run e2e         # headless acceptance: backend + virtual device on scratch ports,
                    # pairing → telemetry → commands → disconnect/reconnect → automations
                    # → security checks; writes tests/e2e/report.json; exits 0 iff all pass
```

`npm test` in a workspace runs its own suite. Backend tests use an in-memory
SQLite DB; the e2e runner uses a scratch DB (`/tmp/aiot-e2e.db`) and scratch
ports (4100/11883/4101 by default), so it never touches dev data.

## Project structure

```
universal-aiot/
├── apps/
│   ├── backend/        # @aiot/backend — Fastify REST API, embedded aedes MQTT
│   │                   # broker, ws realtime, automation rules engine, SQLite
│   │   ├── src/       # auth/, routes/ (auth, orgs, devices, pairing, commands,
│   │   │              # automations, meta), mqtt/ (broker, ingest, publish),
│   │   │              # rules/, services/, migrations/, realtime.ts
│   │   └── tests/     # vitest suites
│   └── dashboard/      # @aiot/dashboard — Vite+React frontend
│       └── src/       # pages/, api/, auth/, components/, ws/, theme/
├── packages/
│   ├── contracts/      # @aiot/contracts — canonical protocol: topics, Zod
│   │                   # schemas, realtime event types, validation helpers
│   └── virtual-device/ # @aiot/virtual-device — bin: aiot-virtual-device,
│                       # hardware-free simulator speaking the exact protocol
├── tests/e2e/          # run.mjs — headless end-to-end acceptance runner
├── docs/               # ARCHITECTURE.md, API.md, PAIRING.md, DEVELOPMENT.md
├── examples/           # (example device configs / client snippets)
├── TEST-REPORT.md/.json# acceptance report from the original monorepo build
├── .env.example        # all env vars with defaults
└── package.json        # npm workspaces: apps/*, packages/*
```

## Security notes

- Passwords and device tokens are **bcrypt-hashed**; plaintext is shown once
  and never logged (auth failures log without the password).
- Pairing credentials are **single-use** with a TTL and are revoked on use,
  rotation, or device deletion; unknown/used/expired pairings return 404 to
  avoid enumeration.
- `JWT_SECRET` is mandatory; the process exits at boot without it.
- Auth/pairing routes have an aggressive rate limit; all other routes a
  global limit; security headers via `@fastify/helmet`.
- SQLite by default; point `DATABASE_URL` at a durable path in production
  and run the backend behind TLS (the embedded broker has no TLS
  termination — use a reverse proxy or `stunnel` in front).

## License

MIT — see [LICENSE](LICENSE).
