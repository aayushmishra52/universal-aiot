# Pinned versions

Every dependency below was verified on **2026-09-20 UTC** against the real
Arduino package/library indexes (or the upstream GitHub release, where
noted). The golden firmware project (ESP32 + DHT22 on GPIO 4 + LED on
GPIO 2) compiles successfully against exactly these versions, and
`aiot-sdk repair` installs them.

| Dependency | Pinned version | Source |
|---|---|---|
| arduino-cli | 1.5.1 | https://arduino.github.io/arduino-cli/installation/ |
| ESP32 Arduino core (`esp32:esp32`) | 3.3.11 | Arduino package index |
| ArduinoJson | 7.3.2 | Arduino Library Manager index |
| espMqttClient | 1.7.3 | **Upstream GitHub release** — not in Library Manager |
| AsyncTCP | 1.1.4 | Arduino Library Manager index |
| DHT sensor library | 1.4.7 | Arduino Library Manager index |
| Adafruit Unified Sensor | 1.1.15 | Arduino Library Manager index |

## Notes

- **espMqttClient** is not published to the Arduino Library Manager. The pin
  refers to the upstream Git tag `v1.7.3` at
  `https://github.com/bertmelis/espMqttClient`; `aiot-sdk repair` downloads
  the release zip and installs it into the sketchbook libraries dir as
  `espMqttClient`.
- **AsyncTCP** is required to compile espMqttClient: its async transport
  translation unit includes `<AsyncTCP.h>` unconditionally on ESP32, even
  when only the synchronous client is used. Without it the build fails with
  `AsyncTCP.h: No such file or directory`.
- **ESP32 core 3.3.11** pulls its tool dependencies from the Arduino package
  index (compiler `esp-x32/2601`, `esptool_py/5.3.1`, `esp32-libs/3.3.11`,
  `mklittlefs`, `mkspiffs`, …). `aiot-sdk repair` installs the core via
  `arduino-cli core install esp32:esp32@3.3.11`, which resolves the tools.

## Where the pins live

- Code: `packages/sdk-generator/src/versions.ts` (`PINNED_VERSIONS`).
- Generated projects: `sketch.yaml` records the versions in comments and
  references the installed libraries by directory
  (`- dir: <sketchbook>/libraries/<name>`); see `README.md` for why.
- `aiot-sdk doctor` verifies the installed toolchain against these pins.
