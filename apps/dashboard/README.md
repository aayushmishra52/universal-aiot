# @aiot/dashboard — AIoT Console

The Universal AIoT web dashboard: a dark-first, capability-driven console for
managing devices, telemetry, commands, automations, and pairing across the
fleet. Everything on screen is derived from device capability manifests —
no hardcoded sensors or controls.

## Quick start

```bash
# from the repo root
npm install
npm run dev --workspace=@aiot/dashboard   # http://localhost:5173
```

The dashboard talks to `@aiot/backend`:

```bash
npm run dev --workspace=@aiot/backend       # REST :4000, realtime WS :4001
```

Or run both together from the root: `npm run dev`.

## Environment variables

| Variable        | Default                 | Purpose                              |
|---------------|-------------------------|--------------------------------------|
| `VITE_API_URL`  | `http://localhost:4000` | Backend REST base URL                |
| `VITE_WS_URL`   | `ws://localhost:4001`   | Backend realtime WebSocket URL       |

Set them in a `.env` file in this directory (see Vite docs) or export them
before `npm run dev` / `npm run build`. They are baked in at build time.

## Scripts

| Script    | What it does                              |
|-----------|-------------------------------------------|
| `npm run dev`     | Start Vite dev server (port 5173)   |
| `npm run build`   | `tsc -p tsconfig.json && vite build` |
| `npm run preview` | Serve the production build locally  |
| `npm test`        | `vitest run` (jsdom)                 |

## App structure

```
src/
  main.tsx            entry point
  App.tsx             router + providers (Auth, Theme, realtime bridge)
  styles.css          hand-rolled design system (CSS variables, dark/light)
  api/client.ts       typed REST client; ApiError{status,message}; token in localStorage
  auth/AuthContext.tsx      login/register/logout/me, roleFor(orgId)
  theme/ThemeContext.tsx    dark|light mode, accent color, card visibility — persisted
  ws/useRealtime.ts         WS hook: auth → subscribe(projectId), auto-reconnect w/ backoff
  ws/RealtimeContext.ts     shares the socket state with all pages
  components/
    Layout.tsx        sidebar nav, topbar (org/project switchers, live dot, theme toggle)
    Chart.tsx         dependency-free SVG time-series chart + sparkline
    widgets.tsx       ★ capability-driven widgets (see below)
    common.tsx        Loading, ErrorBanner, EmptyState, StatusPill, CopyButton, time helpers
  pages/
    Login.tsx / Register.tsx
    DevicesPage.tsx   fleet overview: stats, device grid, live activity feed
    CreateDevicePage.tsx  → shows one-time pairing credentials (copy + warning)
    PairDevicePage.tsx    → exchanges pairing creds for a one-time device token
    DevicePage.tsx    per-device tabs: Overview · Telemetry · Controls ·
                      Health · Events · Automations · Settings
    AutomationsPage.tsx   rule list + condition/action builder
    SettingsPage.tsx  theme mode, accent swatches + custom picker, card visibility
  test/
    widgets.test.tsx  capability widget rendering & command dispatch
    client.test.ts    API client incl. the pair flow (mocked fetch)
    realtime.test.ts  WS hook: auth/subscribe handshake, events, reconnect
```

## Capability-driven widgets

`renderCapabilityWidget(capability, latestValue, onCommand, canControl)` maps
the manifest to UI with zero hardcoded capabilities:

| Capability                        | Widget                                            |
|-----------------------------------|---------------------------------------------------|
| sensor/status/computed (number)   | big value + unit + sparkline                      |
| sensor/status/computed (boolean)  | ON/OFF pill                                       |
| sensor/status/computed (enum/str) | read-only badge                                   |
| actuator boolean                  | toggle switch → `onCommand(id, "set", {value})`   |
| actuator enum                     | select from `enumValues`                          |
| actuator number/integer + min/max | slider (clamped)                                  |
| actuator number/integer, unbounded| numeric input + Send                              |
| actuator string                   | text input + Send                                 |

Viewers (`canControl=false`) see read-only readouts with a view-only hint —
command controls are never rendered for them.

## Realtime

`useRealtime(projectId, token)` opens `VITE_WS_URL`, sends
`{type:"auth", token}` then `{type:"subscribe", projectId}`, and surfaces
`{connected, lastEvent, events, reconnect}`. DevicePage folds
`device.online/offline/telemetry/state_changed/health` and
`command.created/acknowledged/failed` events into live state; DevicesPage
merges presence into the device grid and shows a live activity feed.

## Roles

Role is resolved per selected org (`roleFor`). VIEWER hides/disables all
command controls; ADMIN/OWNER unlock Settings-tab actions (credential
rotation, device deletion) and automation management.

## Tests

```bash
npm test --workspace=@aiot/dashboard
```

18 tests across 3 files: widget rendering/dispatch (9), API client incl. pair
flow and error mapping (4), realtime hook incl. reconnect backoff (5).
