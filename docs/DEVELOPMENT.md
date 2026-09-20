# Development

## Prerequisites

- Node.js **>= 22** (engines field enforced)
- npm (workspaces)

## Scripts (repo root)

| Script | What it does |
|---|---|
| `npm install` | install all workspaces |
| `npm run dev` | backend (`tsx watch apps/backend/src/index.ts`) + dashboard (`vite`) concurrently |
| `npm run build` | `npm run build --workspaces --if-present` → `tsc` for contracts/backend/virtual-device, `vite build` for dashboard |
| `npm test` | `npm run test --workspaces --if-present` → `vitest run` per workspace |
| `npm run e2e` | `node tests/e2e/run.mjs` — headless acceptance (needs built packages) |
| `npm run device:simulate` | `aiot-virtual-device --preset golden-room` |

Workspace-scoped: `npm run <script> --workspace=@aiot/backend`, e.g.
`npm run typecheck --workspace=@aiot/backend` (`tsc -p tsconfig.check.json --noEmit`).

## Ports (defaults)

| Port | Service | Env var |
|---|---|---|
| 4000 | backend REST (`/api`) | `PORT` |
| 1883 | MQTT broker | `MQTT_PORT` |
| 4001 | realtime WebSocket | `WS_PORT` |
| 5173 | dashboard dev server (Vite) | — |

## Environment setup

```bash
cp .env.example .env
# edit JWT_SECRET — the backend refuses to boot without it
npm install
npm run dev
```

The dashboard reads `VITE_API_URL` / `VITE_WS_URL` at build/dev time.

## Database & migrations

- SQLite via `better-sqlite3`, file at `DATABASE_URL` (default
  `file:./data/aiot.db`).
- Migrations run automatically at backend boot
  (`src/migrations/index.ts`; current: `001_init.ts` — users, orgs,
  memberships, projects, devices, capabilities, device_state,
  device_health, telemetry, pairings, device_credentials, commands,
  automations, automation_runs, audit).
- To reset dev data: stop the backend, delete the `.db` file, restart.

## Running tests

```bash
npm test                                  # all workspaces
npm run test --workspace=@aiot/contracts
npm run test --workspace=@aiot/backend    # in-memory SQLite
npm run test --workspace=@aiot/virtual-device
npm run test --workspace=@aiot/dashboard
```

Backend unit tests use an isolated in-memory DB — safe to run anytime.

### End-to-end

```bash
npm run build --workspaces --if-present   # required: e2e boots dist/ builds
npm run e2e
```

The runner (`tests/e2e/run.mjs`) boots the backend on scratch ports
(4100/11883/4101) with a scratch DB (`/tmp/aiot-e2e.db`) and a JWT secret
for the run only, then drives 16+ acceptance steps — register/login, org +
project + device creation, virtual-device pairing, telemetry, commands,
safety checks, disconnect/reconnect, automations, security checks — and
writes `tests/e2e/report.json`, exiting 0 only if every step passes. It
cleans up its processes and DB afterwards.

## Monorepo layout

- `apps/backend` — `@aiot/backend` (Fastify, aedes, ws, better-sqlite3)
- `apps/dashboard` — `@aiot/dashboard` (Vite + React + TypeScript)
- `packages/contracts` — `@aiot/contracts` (Zod schemas, topic builders)
- `packages/virtual-device` — `@aiot/virtual-device` (bin:
  `aiot-virtual-device`; library export for embedding)
- `tests/e2e` — acceptance runner + `report.json` from the last run
- Root `package.json` — workspaces `apps/*`, `packages/*`; root
  devDependencies are `concurrently`, `typescript`, plus `mqtt` and `ws`
  (the e2e runner imports them directly at the root, so they must resolve
  at the root).

Cross-package imports use `@aiot/contracts` (workspace-linked by npm).

## ESP32 firmware

Firmware scaffolding/testing for real hardware is **not** in this repo —
it's the [`aiot-sdk` CLI](https://github.com/<your-username>/aiot-sdk) in
its own repo. It generates firmware against the same `@aiot/contracts`
protocol, so generated devices talk to this backend and dashboard directly.
