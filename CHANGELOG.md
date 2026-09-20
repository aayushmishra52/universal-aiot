# Changelog

All notable changes to the Universal AIoT platform will be documented here.

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
