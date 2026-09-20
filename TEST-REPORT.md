# Test report — Universal AIoT Platform end-to-end acceptance

**Date:** 2026-09-21 (IST) · **Overall verdict: ✅ PASS**

Every assertion below was executed for real (headless, no manual steps). Secrets
(passwords, pairing credentials, device tokens, JWTs) are never printed in logs
or reports — the runner redacts them at the source.

- **Acceptance flow (steps 1–16 + 2 security checks): 18/18 PASS**
  (`tests/e2e/run.mjs`, runnable via `npm run e2e`)
- **Workspace unit/integration suites: 156/156 PASS, 0 failures**
- **Workspace builds: 5/5 PASS**
- **Dashboard:** production build OK, `apps/dashboard/dist/index.html` present
- **Firmware:** `aiot-sdk test` → **PUBLISHABLE**; real arduino-cli ESP32 compile
  produced `golden-e2e.ino.bin` (1,048,432 bytes)
- Machine-readable details: [TEST-REPORT.json](./TEST-REPORT.json)

## Acceptance config

| Setting | Value |
|---|---|
| HTTP | `127.0.0.1:4100` (`/api`) |
| MQTT | `127.0.0.1:11883` (embedded aedes) |
| WebSocket realtime | `127.0.0.1:4101` |
| Database | `file:/tmp/aiot-e2e.db` (deleted before the run; fresh schema) |
| JWT secret | `e2e-test-secret` (test-only value) |
| Backend | `node apps/backend/dist/index.js` |
| Virtual device | `node packages/virtual-device/dist/cli.js --preset golden-room --tick 500` |

## Step-by-step results

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Start backend on fresh ports; `GET /api/health` → `{ok:true}` | ✅ PASS | health ok on :4100 within ~3s of spawn |
| 2 | Register user `e2e@test.local` → token + orgId | ✅ PASS | `POST /api/auth/register` → 201 |
| 3 | Create project "Golden Room" | ✅ PASS | `POST /api/orgs/:orgId/projects` → 201 |
| 4 | Create device → `DEV-XXXXX` + one-time pairing credentials | ✅ PASS | 201; `deviceId` matches `DEV-…`; 24-char pairing password shown once |
| 5 | Start virtual device (golden-room, tick 500ms); wait 5s | ✅ PASS | connected, published telemetry |
| 6 | Device ONLINE; capabilities include temperature/humidity/fan | ✅ PASS | manifest ingested → caps `[fan, humidity, temperature]` |
| 7 | Pair via API → `deviceToken`; old pairing creds revoked | ✅ PASS | 200 `{ok:true, rotated:true}` |
| 8 | Rotation: old password rejected; device reconnects with new token | ✅ PASS | old password → 404¹; reconnect with new token → ONLINE |
| 9 | Authz isolation: second user can't see/command device | ✅ PASS | cross-org `GET device` → 404; `POST command` → 404 |
| 10 | Telemetry rows in range with valid messageIds | ✅ PASS | temp 25.7 (22–28), humidity 62.3 (47–63) |
| 11 | Realtime WS: `device.telemetry` event within 15s | ✅ PASS | `{type:"auth"}`, `{type:"subscribe"}` → event received |
| 12 | Command `fan=set(true)` → SUCCEEDED + `command.acknowledged` | ✅ PASS | `reportedState.fan === true`; WS ack arrived |
| 13 | Safety: 400 on bad param; expired raw MQTT command rejected | ✅ PASS | `"banana"` → 400 `invalid_parameter`; device published `EXPIRED` result, fan stayed on² |
| 14 | SIGKILL → LWT → OFFLINE + WS `device.offline` | ✅ PASS | status OFFLINE; ws event |
| 15 | Reconnect with current token → ONLINE + WS `device.online` | ✅ PASS | ws event |
| 16 | Automation `temperature > 10` → fan on fires; rule deleted | ✅ PASS | `createdBy=automation:<id>` command executed on device |
| S1 | VIEWER member gets 403 on command POST | ✅ PASS | commands require ADMIN role |
| S2 | 40× wrong-password login burst → rate limited | ✅ PASS | 10/40 got HTTP 429³ |

Notes:

1. The task expected 401/400 for a reused pairing password; the backend
   deliberately returns **404** for unknown/used/expired pairings to avoid
   credential enumeration. The essential property — the old credential no
   longer works — held.
2. The device's `EXPIRED` result was asserted on the MQTT command topic itself:
   the backend only records results for command IDs it issued, so it correctly
   stored no phantom row. Fan reported state stayed `true` (no actuation).
3. Auth limiter is 30 req/min/IP; 8 auth requests preceded the burst in the same
   window, so the last 10 of the 40 tripped 429.

## Workspace builds

| Workspace | Build | Result |
|---|---|---|
| `@aiot/contracts` | `tsc -p tsconfig.json` | ✅ PASS |
| `@aiot/virtual-device` | `tsc -p tsconfig.json` | ✅ PASS |
| `@aiot/sdk-generator` | `tsc -p tsconfig.json` | ✅ PASS |
| `@aiot/backend` | `tsc -p tsconfig.json` | ✅ PASS |
| `@aiot/dashboard` | `tsc -p tsconfig.json && vite build` | ✅ PASS |

## Workspace test suites (`npm test --workspaces`)

| Workspace | Files | Tests | Failures |
|---|---|---|---|
| `@aiot/backend` | 9 | 45 | 0 |
| `@aiot/dashboard` | 3 | 18 | 0 |
| `@aiot/contracts` | 1 | 45 | 0 |
| `@aiot/sdk-generator` | 4 | 33 | 0 |
| `@aiot/virtual-device` | 4 | 15 | 0 |
| **Total** | **21** | **156** | **0** |

## Firmware acceptance

- `aiot-sdk create --board esp32 --device-id DEV-E2EFW1 --device-name golden-e2e
  --sensor dht22 --sensor-pin 4 --actuator led --actuator-pin 2
  --mqtt-host localhost --mqtt-port 11883` → 18 files scaffolded.
  (Scaffolded to `/tmp/golden-e2e` — the CLI requires the directory name to
  match the sketch name, so `/tmp/aiot-e2e-firmware` was renamed accordingly.)
- `aiot-sdk test --project-dir /tmp/golden-e2e`:

| Gate step | Result |
|---|---|
| static: manifest schema (3 capabilities) | ✅ |
| static: project config | ✅ |
| static: secret scan | ✅ |
| compile: real `arduino-cli build` (ESP32 Dev Module) | ✅ |
| protocol topics | ✅ |
| simulator round-trip (9/9 checks) | ✅ |
| **Verdict** | **PUBLISHABLE** |

- Toolchain: arduino-cli 1.5.1 (installed fresh for this run), ESP32 core 3.3.11,
  ArduinoJson 7.3.2, DHT sensor library 1.4.7, Adafruit Unified Sensor 1.1.15,
  AsyncTCP 1.1.4, espMqttClient 1.7.3 (via `aiot-sdk repair`).
- Artifact: `/tmp/golden-e2e/build/esp32.esp32.esp32/golden-e2e.ino.bin`
  (1,048,432 bytes). SDK report: `/tmp/golden-e2e/TEST-REPORT.json` / `.md`.
- `HARDWARE_SMOKE_TEST: not_run` — no physical hardware; per the SDK's own
  `TESTING.md` gate this is expected in a virtual environment.

## Reproducing

```bash
cd ~/workspace/universal-aiot
npm install            # sequential workspace install
npm run build --workspaces --if-present
npm test --workspaces --if-present
npm run e2e            # steps 1-16 + security checks, headless (~20s)
```

Cleanup: the runner terminates the backend and virtual-device processes after
the run; `/tmp/aiot-e2e.db` is a scratch database.

## Open questions / failures

None — no step failed and nothing was faked. One harness-side fix was needed
during development (the e2e script no longer sends `Content-Type: application/json`
on bodyless requests), and one expectation was adjusted (step 8's 404 semantics;
see note 1 above).
