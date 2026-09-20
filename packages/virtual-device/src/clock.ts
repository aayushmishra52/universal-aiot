/**
 * VirtualClock — a manually-advancible clock for the virtual device.
 *
 * All device time (telemetry timestamps, heartbeats, command expiry) runs on
 * this clock so tests can drive time deterministically with `advance()` /
 * `set()` instead of real timers.
 */
export class VirtualClock {
  private t: number;

  constructor(startMs: number = Date.now()) {
    this.t = startMs;
  }

  /** Current virtual time in ms epoch. */
  now(): number {
    return this.t;
  }

  /** Move the clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    this.t += ms;
  }

  /** Jump the clock to an absolute ms-epoch value. */
  set(ms: number): void {
    this.t = ms;
  }
}
