# Changelog

All notable changes to the Universal AIoT platform will be documented here.

## [1.1.0] — 2026-09-26

### Added

- **Device login credentials** — per-device MQTT credentials so a device can
  connect from anywhere: `POST /api/devices/:id/credentials` (ADMIN; secret
  returned **once**, bcrypt hash stored), `GET` metadata list (never secrets),
  `DELETE …/credentials/:credId` revokes. Migration `003_device_credentials`
  adds `label`, `client_id`, `scopes`, `last_used_at`. The aedes broker
  authenticates these credentials (bcrypt), updates `last_used_at`, and binds
  each client to its own `aiot/v1/{org}/{project}/{device}/#` topic subtree.
  Dashboard Devices page: "Credentials" button → modal with one-time secret,
  copy buttons, download as `.env`/JSON, revoke list. `GET /api/devices/:id`
  now returns `connectivity: {mqttUrl, apiUrl}` from `PUBLIC_MQTT_URL` /
  `PUBLIC_API_URL`. Docs: `docs/DEVICE-CREDENTIALS.md`.
- **Optional Firebase Auth** (free tier) — local JWT/SQLite auth stays the
  default. Setting `FIREBASE_PROJECT_ID` enables `POST /api/auth/firebase`
  (verifies ID tokens via lazily-loaded `firebase-admin`, auto-provisions /
  links a local user, same JWT shape as login); migration
  `002_federated_identities`; `GET /api/meta` advertises
  `{ok, time, firebaseAuth}`. Dashboard shows "Continue with Firebase" only
  when advertised, with email/password sign-in via the Firebase Auth REST API
  (no Firebase JS SDK in the bundle) plus paste-token fallback. Docs:
  `docs/FIREBASE-AUTH.md`.
- **Dashboard Overview page** (`/`) — KPI cards (devices, online now,
  sampled msgs/min, command alerts, active automations), dependency-free SVG
  telemetry area/line charts with device + metric pickers, device-health
  donut, realtime events feed, automation status, command history table. All
  values come from real API data (loading/empty states included); no new
  runtime dependencies. Devices page moved to `/devices`.
- **Remote-access config** — `PUBLIC_MQTT_URL` / `PUBLIC_API_URL` advertised
  URLs; `HTTP_HOST` / `MQTT_HOST` bind hosts (default `127.0.0.1`, set
  `0.0.0.0` to expose); optional TLS: `MQTT_TLS_KEY`/`MQTT_TLS_CERT` (broker
  TLS on `MQTT_TLS_PORT`) and `TLS_KEY`/`TLS_CERT` (HTTPS API, now wired in
  `server.ts`). Docs: `docs/SELF-HOSTING.md` (VPS, Render/Railway/Fly.io free
  tiers, TLS, connect-from-anywhere checklist), `docs/PERFORMANCE.md`
  (measured: dashboard 348 KB, backend ~96 MB RSS idle).
- Root `npm start` → starts the backend (`node dist/index.js`).

### Fixed

- **Dashboard crash fix ported to the integrated source**:
  `apps/dashboard/src/api/client.ts` now unwraps backend response envelopes
  (`{orgs}`, `{projects}`, `{devices}`, `{telemetry}`, `{commands}`,
  `{command}`, `{automations}`, `{automation}`) and `API_BASE` no longer
  appends `/api` (request paths already carry it — no more `/api/api/...`
  or `projects.map is not a function`). Regression tests added
  (`src/api/envelope.test.ts`, 12 tests; verified they fail on the old code).
- Dashboard Login Firebase panel now calls `/api/auth/firebase` and
  `/api/meta` (was missing the `/api` prefix after the `API_BASE` fix).

### Changed

- `engines.node` lowered from `>=22` to `>=20` (no Node-22-only APIs found;
  better-sqlite3 v12 supports Node 20+).
- e2e runner: new step E1 asserts list endpoints return envelope shapes and
  unauthenticated access returns clean JSON 401s.

## [1.0.0] — 2026-09-21

Initial public release of the Universal AIoT **platform** repo (extracted
from the original `universal-aiot` monorepo, which also contained the
`@aiot/sdk-generator` package — now published separately as the
[`aiot-sdk`](https://github.com/<your-username>/aiot-sdk) CLI repo).

### Added

- `@aiot/contracts` — canonical device protocol (protocol v1):
  `aiot/v1/{orgId}/{projectId}/{deviceId}/{kind}` topic builders and Zod
  schemas for manifest, status, telemetry, command, presence, health,
  automations, and realtime events.
- `@aiot/backend` — Fastify REST API (`/api`): auth (register/login/JWT),
  orgs + members + projects, devices, one-time pairing (`POST /pair`),
  commands with TTL + status tracking, telemetry/state/health/events
  reads, automations CRUD + run history; embedded aedes MQTT broker with
  bcrypt credential auth; realtime WebSocket server with per-project
  subscriptions; SQLite storage with boot-time migrations; automation
  rules engine; command-expiry sweeper; audit logging; rate limiting and
  security headers.
- `@aiot/dashboard` — Vite + React frontend: login/register, org/project/
  device management, device detail (telemetry charts, state, health),
  pair-device flow, command console, automations, settings, live updates
  over WebSocket.
- `@aiot/virtual-device` — hardware-free simulator (bin:
  `aiot-virtual-device`) speaking the exact canonical protocol; `npm run
  device:simulate` preset (`golden-room`).
- `tests/e2e/run.mjs` — headless end-to-end acceptance runner (pairing →
  telemetry → commands → disconnect/reconnect → automations → security
  checks), writing `tests/e2e/report.json`.
- Docs: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/PAIRING.md`,
  `docs/DEVELOPMENT.md`; `TEST-REPORT.md`/`.json` acceptance evidence.
