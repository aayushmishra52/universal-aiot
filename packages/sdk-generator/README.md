# @aiot/sdk-generator

Scaffold, build, test, and maintain Universal AIoT ESP32 firmware projects.
Part of the `universal-aiot` npm workspace. Requires Node >= 22.

## Install

```sh
npm install            # from the workspace root
npm run build --workspace=@aiot/sdk-generator
```

The CLI is available as `aiot-sdk` (package bin: `./dist/cli/index.js`).

## Commands

| Command | What it does |
|---|---|
| `aiot-sdk create` | Scaffold a firmware project. Validates **everything before writing anything**. Flag mode or interactive prompts. |
| `aiot-sdk build` | Compile the firmware with arduino-cli (uses the project's `sketch.yaml` profile). |
| `aiot-sdk test` | Full pipeline: manifest schema → project config → secret scan → compile → protocol topics → simulator round-trip. Verdict: `PUBLISHABLE` or not. |
| `aiot-sdk simulate` | Shell out to `npx aiot-virtual-device`. Fails clearly if the package is unavailable — never fakes a simulation. |
| `aiot-sdk doctor` | Check the toolchain (arduino-cli, ESP32 core, pinned libraries). |
| `aiot-sdk diagnose` | Explain the most recent failure with actionable hints. |
| `aiot-sdk repair` | Install the pinned ESP32 core and libraries (see `PINNED_VERSIONS.md`). Never touches your config. |
| `aiot-sdk clean` | Remove build artefacts. |
| `aiot-sdk flash` | Flash firmware to a connected board. |
| `aiot-sdk package` | Bundle the project for distribution. |

## Quick start

```sh
# 1. Toolchain (once per machine)
aiot-sdk repair

# 2. Scaffold — ESP32 + DHT22 on GPIO 4 + LED on GPIO 2
aiot-sdk create --board esp32 \
  --device-id DEV-GOLD1 --device-name "Golden Room" \
  --project-id project-1 --org-id org-1 \
  --sensor dht22 --sensor-pin 4 \
  --actuator led --actuator-pin 2 \
  --mqtt-host localhost

# 3. Fill in secrets (config/config.h is gitignored)
cd golden-room
cp config/config.example.h config/config.h

# 4. Validate + compile + protocol + simulator tests
aiot-sdk test

# 5. Flash
aiot-sdk flash --port /dev/ttyUSB0
```

## Generated project layout

```
golden-room/
  golden-room.ino        # sketch entry point (dir name == .ino name, required by arduino-cli)
  AIoT.h / AIoT.cpp     # runtime: MQTT, state machine, telemetry queue, commands, watchdog
  adapters/             # sensor/actuator hardware adapters (dht22.h, analog.h, digital.h)
  config/
    aiot.config.json    # generator input (no secrets) — drives build/test/flash
    config.h            # WiFi/MQTT secrets (gitignored)
    config.example.h    # template for config.h
  manifest.json         # canonical device manifest (validated against @aiot/contracts)
  manifest_json.h       # manifest embedded for the firmware to publish (retained)
  sketch.yaml           # arduino-cli profile: pinned FQBN + pinned library versions
  pinout.json           # machine-readable pin map
  WIRING.md / wiring.svg# human wiring docs
  README.md / TESTING.md# project docs
```

Rendering is deterministic: the same input produces byte-identical output
(no timestamps in generated files).

## Generated firmware runtime

Real C++ for ESP32 (Arduino core), not a stub:

- **MQTT** via `espMqttClient` (not PubSubClient), with Last Will (LWT).
- **Lifecycle state machine**: BOOT → SELF_TEST → NETWORK_CONNECTING →
  MQTT_CONNECTING → REGISTERING → ONLINE, with OFFLINE/RECONNECTING handling.
- **Telemetry queue** with non-blocking scheduling (no `delay()` in the loop).
- **Commands**: validated against the manifest, deduplicated by id, expire
  after a TTL; every command gets an ACK first, then a RESULT.
- **Safe actuator defaults**: actuators start in their safe state and return
  to it on disconnect/watchdog reset.
- **Watchdog** enabled; JSON via ArduinoJson.

Protocol topics come from the canonical `@aiot/contracts` builders
(`aiot/v1/<org>/<project>/<device>/telemetry`, `.../command`, `.../ack`,
`.../result`, `.../manifest`, `.../presence`).

### TLS note (MVP)

When `--tls` is used, the firmware currently calls `setInsecure()` (no CA
bundle is shipped; hostname verification is skipped). This is flagged in the
generated code with a pointer to `setCACert()` for production deployments.

## sketch.yaml — why it looks the way it does

arduino-cli "profiles" isolate builds: a `platforms:` entry **with** a
version, or a `libraries:` entry like `- ArduinoJson (7.3.2)`, makes
arduino-cli re-download that dependency into a per-profile cache — even when
it is already installed. That breaks offline/air-gapped builds.

The generated profile therefore uses the offline-friendly forms:

```yaml
profiles:
  esp32:
    fqbn: esp32:esp32:esp32
    platforms:
      - platform: esp32:esp32        # no version → system-installed core
    libraries:
      - dir: /home/you/Arduino/libraries/ArduinoJson   # no download
```

- The versionless platform reference uses the ESP32 core installed by
  `aiot-sdk repair`.
- Libraries are referenced by directory. `aiot-sdk create` resolves the
  sketchbook location from `arduino-cli config get directories.user`
  (falling back to `~/Arduino`); `aiot-sdk repair` installs the pinned
  versions there, so both sides agree.
- The pinned versions are still recorded — in comments in `sketch.yaml`,
  in `src/versions.ts`, and in `PINNED_VERSIONS.md`.

If you move your sketchbook, update the `dir:` paths in `sketch.yaml`
(or re-run `aiot-sdk create`).

## Testing

```sh
npm test --workspace=@aiot/sdk-generator
```

Unit tests cover input validation (bad/reserved/duplicate pins, bad device
ids), topic builders, manifest generation, render determinism (byte-identical
for the same input), secret scanning, and the in-process `aedes` MQTT
simulator round-trip (telemetry → command → ACK → RESULT).
