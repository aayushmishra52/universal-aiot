/**
 * Pinned dependency versions for generated firmware.
 *
 * Every version below was verified against the real Arduino package/library
 * index (or the upstream GitHub release, where noted) and the golden-room
 * firmware compiles against exactly these versions. See PINNED_VERSIONS.md.
 */
export const PINNED_VERSIONS = {
  /** esp32 Arduino core (from the Arduino package index). */
  esp32Core: "3.3.11",
  /** ArduinoJson (from the Arduino library index). */
  arduinoJson: "7.3.2",
  /**
   * espMqttClient — NOT in the Arduino Library Manager index.
   * Pinned to the upstream GitHub release tag v1.7.3 and installed from
   * https://github.com/bertmelis/espMqttClient by `aiot-sdk repair`.
   */
  espMqttClient: "1.7.3",
  /** DHT sensor library (from the Arduino library index). */
  dhtSensor: "1.4.7",
  /** Adafruit Unified Sensor (from the Arduino library index). */
  adafruitUnified: "1.1.15",
  /**
   * AsyncTCP (from the Arduino library index). Required to compile
   * espMqttClient: its async transport translation unit includes
   * <AsyncTCP.h> unconditionally on ESP32, even when only the sync
   * client is used.
   */
  asyncTcp: "1.1.4",
} as const;

export type PinnedVersions = typeof PINNED_VERSIONS;
