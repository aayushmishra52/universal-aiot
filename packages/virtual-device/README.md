# @aiot/virtual-device

A first-class virtual device for the Universal AIoT platform. It speaks the
**exact canonical protocol** (`@aiot/contracts`) — the same MQTT topics and
the same Zod schemas as the real ESP32 firmware — so backends, dashboards, and
automations cannot tell it apart from physical hardware.

## Install

```bash
npm install          # at the repo root (npm workspaces)
npm run build --workspace=@aiot/virtual-device
```

## CLI

```bash
npx aiot-virtual-device \
  --broker mqtt://localhost:1883 \
  --org org_123 --project proj_abc --device DEV-00001 \
  --username device --password secret \
  --preset golden-room --tick 1000
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--broker` | yes | — | MQTT broker URL, e.g. `mqtt://localhost:1883` |
| `--org` | yes | — | Organization id (topic segment) |
| `--project` | yes | — | Project id (topic segment) |
| `--device` | yes | — | Device id, e.g. `DEV-00001` |
| `--username` | yes | — | MQTT username |
| `--password` | yes | — | MQTT password (never logged) |
| `--preset` | no | `golden-room` | Device preset (`golden-room`) |
| `--tick` | no | `1000` | Virtual tick interval in ms |

`npm run simulate --workspace=@aiot/virtual-device` runs the CLI with
`--preset golden-room` (broker/credentials still required via flags).

Example output:

```
[VD] DEV-00001 connected
[VD] telemetry temperature=25.3 humidity=58.2
[VD] command fan=set -> SUCCEEDED
```

`SIGINT`/`SIGTERM` disconnects gracefully (publishes presence offline first).

## Library usage

```ts
import { VirtualDevice, goldenRoomPreset } from "@aiot/virtual-device";

const device = new VirtualDevice({
  brokerUrl: "mqtt://localhost:1883",
  orgId: "org_123",
  projectId: "proj_abc",
  deviceId: "DEV-00001",
  username: "device",
  password: "secret",
  preset: goldenRoomPreset(), // optional, this is the default
  tickMs: 1000,
});

device.on("telemetry", (t) => console.log(t.values));
device.on("command", (c) => console.log(c.capabilityId, c.status));

await device.connect();   // presence online, REGISTERING -> ONLINE, manifest, health
// ...runs on its own tick loop...
await device.disconnect(); // presence offline, graceful MQTT disconnect
```

## Protocol behavior

On connect the device publishes (all QoS 1):

1. `.../presence` — `{ online: true }` (an LWT with `{ online: false }` is
   registered so the broker announces unexpected drops)
2. `.../status` — `REGISTERING`, then `ONLINE`
3. `.../manifest` — validated with `DeviceManifestSchema` before publishing
4. `.../health` — uptime (virtual seconds), mqtt state, firmware,
   `sensorErrors`, per-capability health

Then it subscribes to `.../command`.

Every tick the virtual clock advances by `tickMs`; sensors whose
`samplingInterval` elapsed are sampled and published as one telemetry message
validated with `TelemetrySchema` (`messageId` via `makeMessageId`, monotonic
`sequence`, `timeQuality: "synchronized"`). Every 30 virtual seconds a
presence + health heartbeat is published.

Commands are checked in order, with results published back on the command
topic:

1. `isExpired(cmd, clock.now())` → `EXPIRED`
2. duplicate `commandId` (LRU set, cap 200) → `DUPLICATE`, no execution
3. capability missing or not an actuator → `REJECTED`
4. `validateCapabilityValue` fails → `FAILED` with `INVALID_PARAMETER: …`
5. otherwise the actuator executes: desired state → virtual hardware →
   `ACKNOWLEDGED`, then reported state → `SUCCEEDED` with `reportedState`

`device.getState()` exposes `{ desired, reported, fanOn }`.

## Virtual time

All device time runs on a `VirtualClock`. Pass `manualTick: true` and drive
`device.tick()` yourself for fully deterministic, timer-free tests:

```ts
const device = new VirtualDevice({ ..., manualTick: true });
await device.connect();
device.tick(); // advance 1000 virtual ms, publish due telemetry
```

`src/presets.ts` also exports `sensorEngines` (`constant`, `sine`,
`sequence`, `withNoise`) plus the golden-room `temperatureModel` /
`humidityModel` for building custom presets.

## Fault injection

```ts
device.simulateSensorFailure("humidity"); // telemetry quality "error",
                                          // capabilityHealth "error", sensorErrors++
device.clearSensorFailure("humidity");    // or clearSensorFailure() for all

device.simulateDropConnection(); // unclean drop: broker fires the LWT
                                 // (presence offline), then the device
                                 // reconnects with exponential backoff
                                 // (1s, 2s, 4s … max 30s) and re-announces
                                 // presence online + manifest.
```

`device.getConnectionState()` returns
`disconnected | connecting | connected | reconnecting`.

## Tests

```bash
npm test --workspace=@aiot/virtual-device
```

Tests spin up an in-process `aedes` broker on an ephemeral port and use a
real `mqtt` client — covering the virtual clock, manifest/telemetry schema
validity, the full command lifecycle (ACK → SUCCEED, expiry, duplicates,
invalid params, unknown capabilities), LWT + reconnect, and sensor-failure
injection.
