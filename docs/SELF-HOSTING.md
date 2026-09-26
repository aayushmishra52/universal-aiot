# Self-Hosting Guide — Universal AIoT Platform

Everything here assumes the **production build** (`npm run build` at the repo root),
not the dev servers. No Docker, no Postgres, no managed services required:
the backend is Fastify + SQLite (`better-sqlite3`) with an **embedded aedes MQTT
broker**, and the dashboard is a static bundle you serve with any HTTP server.

> Numbers below come from measurements taken on 2026-09-26 (Node v24.20.0,
> Linux, from the built `dist/` output). Anything marked **unverified** was
> derived from reading the code, not run end-to-end on a remote host.

## 1. Minimum specs

| Resource | Requirement | Measured / source |
|---|---|---|
| Node.js | **22+** (root `engines` field says `>=22`) | verified via package.json |
| RAM | **512 MB** recommended — the backend idles at ~96 MB | measured: 96 MB idle, 97 MB after 100 `/api/health` requests (RSS, no swap pressure) |
| Disk | **~250 MB** free | measured: repo without `node_modules` = 2.9 MB; `node_modules` = 184 MB; dashboard `dist/` = 348 KB; backend `dist/` = 536 KB |
| OS | Any Linux/macOS/Windows | **unverified** outside this Linux container; nothing in the code is Linux-specific |

Dashboard bundle (production): `apps/dashboard/dist` = **348 KB** total —
`index-CN4VdlE3.js` 324 KB, `index-Haoo5bXh.css` 20 KB, `index.html` 0.8 KB.
Charts are dependency-free SVG hand-rolled in the app — a bundle-wide grep for
`chart.js`, `recharts`, and `d3` returns **zero hits** (no chart library bundled).

## 2. Local production run (the one-command path)

```bash
# 1. build everything (backend tsc + dashboard vite build + packages)
npm run build

# 2. configure (minimum viable .env — JWT_SECRET is REQUIRED, the backend refuses to boot without it)
cp .env.example .env
# edit .env: set JWT_SECRET to a long random string, e.g.:
#   JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 3. start the backend (HTTP :4000, MQTT :1883, WebSocket :4001)
npm run start --workspace=@aiot/backend
# — or —  JWT_SECRET=... node apps/backend/dist/index.js

# 4. serve the dashboard bundle with any static server (SPA: fall back to index.html for unknown paths)
cd apps/dashboard/dist && python3 -m http.server 5175
# — or —  npx --yes serve -s apps/dashboard/dist -l 5175
```

Verified working end-to-end locally: `npm run build` succeeds from a clean
tree, `node apps/backend/dist/index.js` boots (logs `http`, `mqtt`, `ws`
listeners), `/api/health` answers `200`, the embedded MQTT broker rejects
anonymous connections with `Bad username or password` (device-credential auth
works as designed), and `index.html` serves `200` from a static server.

Note: the **root** `package.json` has no `start` script — see the snippet in
the deployment section below if you want a root-level one.

### Environment variables that matter

Copy from `.env.example` at the repo root (backend reads `dotenv` at boot):

| Variable | Default | What it does |
|---|---|---|
| `JWT_SECRET` | *(none — boot fails without it)* | Signs dashboard/API tokens |
| `DATABASE_URL` | `file:./data/aiot.db` | SQLite file location |
| `PORT` | `4000` | REST API |
| `MQTT_PORT` | `1883` | Device MQTT (plain) |
| `WS_PORT` | `4001` | Dashboard realtime WebSocket |
| `PUBLIC_MQTT_URL` | `mqtt://localhost:1883` | URL shown to devices / the SDK CLI for provisioning |
| `PUBLIC_API_URL` | `http://localhost:4000` | URL advertised for the API |
| `VITE_API_URL` / `VITE_WS_URL` | `http://localhost:4000` / `ws://localhost:4001` | **Build-time** dashboard config — bake in at build with env set, e.g. `VITE_API_URL=https://api.example.com npm run build --workspace=@aiot/dashboard` |

## 3. VPS deploy (any Ubuntu box)

```bash
# 1. install Node 22+ (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 2. get the code
scp universal-aiot.zip user@vps:~ && unzip universal-aiot.zip && cd universal-aiot

# 3. build (uses npm workspaces; no separate installs needed beyond this)
npm run build        # NOTE: this currently requires network for npm workspaces deps.
                     # "no new tooling" verified: plain npm + node only.

# 4. .env — at minimum JWT_SECRET; set PUBLIC_* URLs to your domain
cp .env.example .env && nano .env
```

systemd unit example (`/etc/systemd/system/aiot-backend.service`) — **unverified on a live VPS**:

```ini
[Unit]
Description=Universal AIoT backend
After=network.target

[Service]
User=aiot
WorkingDirectory=/home/aiot/universal-aiot/apps/backend
EnvironmentFile=/home/aiot/universal-aiot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Serve the dashboard with any static server behind the same reverse proxy, e.g.
an nginx `location /` rooted at `apps/dashboard/dist` with `try_files $uri /index.html`,
API proxying to `127.0.0.1:4000`. Or run the dashboard via `serve -s`.

pm2 alternative — **unverified**: `pm2 start "npm run start --workspace=@aiot/backend" --name aiot`.

## 4. Free-tier options

| Host | Backend (Node) | Dashboard (static) | Notes |
|---|---|---|---|
| **Render** | Free web service | Free static site | Set `PORT` (Render injects it), `JWT_SECRET`, `DATABASE_URL=file:./data/aiot.db`. ⚠️ Render free tier does **not** expose arbitrary TCP ports → the embedded MQTT broker (`MQTT_PORT`) is unreachable from outside. Use `PUBLIC_MQTT_URL` pointing at an external broker free tier (HiveMQ Cloud / EMQX Cloud) — the backend config explicitly supports this — or upgrade to a paid tier for TCP ports. **Unverified.** |
| **Railway** | Free trial credits | Static via same service or separate | Railway exposes TCP ports (paid-ish tiers); set same env vars. **Unverified.** |
| **Fly.io** | Free allowance | Static assets from same app or CDN | Fly supports custom TCP ports (`MQTT_PORT`) via `[[services]]` config. **Unverified.** |

Universal env to set on any of them: `JWT_SECRET`, `PORT`, `DATABASE_URL`,
`PUBLIC_API_URL=https://<your-api-domain>`, `PUBLIC_MQTT_URL=mqtt(s)://<reachable-broker>`.
Rebuild the dashboard with `VITE_API_URL` / `VITE_WS_URL` pointed at the deployed API.

## 5. TLS checklist

The backend natively terminates TLS when you hand it cert paths:

- **HTTPS API:** set `TLS_KEY` and `TLS_CERT` (PEM file paths). Wired in `server.ts`. **Unverified.**
- **MQTTS (devices):** set `MQTT_TLS_KEY` + `MQTT_TLS_CERT`; the broker then listens on `MQTT_TLS_PORT` (default **8883**) with `mqtts://` advertised in `PUBLIC_MQTT_URL`. Wired in `mqtt/broker.ts`. **Unverified.**

Alternative (simpler): terminate TLS at a reverse proxy (nginx/Caddy/Cloudflare),
keep the backend on plain `:4000`/`:1883` bound to `127.0.0.1`, and set the
`PUBLIC_*` URLs to `https://` / `mqtts://` so devices get the right connection strings.

## 6. "Connect from anywhere" checklist

1. `PUBLIC_MQTT_URL` = reachable broker address (e.g. `mqtt://vps.example.com:1883`
   or the external broker you chose). Defaults to `localhost` — devices on your LAN
   will silently fail without this.
2. `PUBLIC_API_URL` = reachable API address (`https://vps.example.com`).
3. Firewall: open **4000** (API), **1883** (MQTT, or **8883** for MQTTS), **4001**
   (dashboard realtime WS — only needed if the dashboard is used remotely).
4. DNS: one A record for the VPS (covers API + MQTT).
5. Broker auth = **device credentials** (pairing username/secret), verified enforced
   — anonymous MQTT is rejected by design. Provision devices via the pairing API /
   aiot-sdk CLI before they connect.

## 7. SQLite backup (safe procedure)

The database runs in **WAL mode** (observed: `aiot.db`, `aiot.db-wal`, `aiot.db-shm`
files appear at runtime). Never copy the `-wal`/`-shm` files alone — use an
online backup instead:

```bash
# safe while the backend is RUNNING (WAL-aware, atomic)
sqlite3 data/aiot.db ".backup '/backups/aiot-$(date +%F).db'"
```

Or stop the backend first, then copy all three files (`aiot.db*`). `sqlite3` CLI
ships with most distros (`sudo apt install sqlite3`); on hosts without it, use
the app's own `better-sqlite3` or stop-the-app-then-copy.

## 8. Resource-tuning knobs

All via env (see `apps/backend/src/config.ts`):

- `SWEEP_INTERVAL_MS` (default `10000`) — how often the command-expiry sweeper
  runs. It only marks `PENDING`/`SENT` commands as `EXPIRED`; it does **not**
  prune telemetry. Raising it (e.g. `60000`) saves a little DB I/O on quiet hosts.
- `RATE_LIMIT_AUTH_PER_MIN` (30) / `RATE_LIMIT_GLOBAL_PER_MIN` (600) — per-IP
  throttles; raise on busy dashboards, lower on exposed hosts.
- `JWT_EXPIRES_IN` (`12h`), `PAIRING_TTL_HOURS` (24) — token lifetimes.
- ⚠️ **No telemetry retention knob exists**: telemetry rows accumulate until you
  delete them manually. On long-lived installs, schedule a periodic
  `DELETE FROM telemetry WHERE ...` (or a cron calling the SQLite backup +
  prune) to bound disk growth. **Unverified** as an operational procedure — the
  table schema was not profiled in this pass.
