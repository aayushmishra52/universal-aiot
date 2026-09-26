/**
 * Board registry — every supported board and its pin map.
 *
 * All board/pin knowledge lives here. Callers validate pins with
 * {@link validatePin}; duplicate-pin detection is the caller's job because
 * only the caller knows the full pin assignment of a project.
 */
import boardsJson from "./boards.json" with { type: "json" };

export interface BoardPins {
  digital: number[];
  adc: number[];
  /** Flash/PSRAM and other hard-reserved pins: never assignable. */
  reserved: number[];
  /** Strapping pins: usable, but produce a warning. */
  bootstrap: number[];
  /** GPIO numbers that can only be inputs (no digitalWrite/PWM). */
  inputOnly: number[];
  strappingNotes: string;
}

export interface Board {
  id: string;
  name: string;
  fqbn: string;
  wifi: boolean;
  bluetooth: boolean;
  adc: boolean;
  i2c: boolean;
  spi: boolean;
  uart: boolean;
  pins: BoardPins;
}

export type PinUsage = "digital" | "adc" | "pwm";

export interface PinValidation {
  ok: boolean;
  /** Machine-friendly reason when ok === false. */
  reason?: string;
  /** Non-fatal caution (e.g. strapping pin) when ok === true. */
  warning?: string;
}

const REGISTRY: Record<string, Board> = (boardsJson as { boards: Record<string, Board> }).boards;

export function listBoards(): Board[] {
  return Object.values(REGISTRY);
}

export function boardIds(): string[] {
  return Object.keys(REGISTRY);
}

export function getBoard(boardId: string): Board | undefined {
  return REGISTRY[boardId];
}

/**
 * Validate a single pin assignment for a board.
 *
 * - unknown board / non-integer pin -> reject
 * - reserved (flash/PSRAM) pins -> reject
 * - `adc` usage requires an ADC-capable pin
 * - `pwm` usage requires an output-capable GPIO
 * - `digital` usage requires a GPIO pin
 * - strapping (bootstrap) pins -> ok with a warning
 */
export function validatePin(
  boardId: string,
  pin: number,
  usage: PinUsage,
): PinValidation {
  const board = REGISTRY[boardId];
  if (!board) {
    return {
      ok: false,
      reason: `Unknown board "${boardId}". Known boards: ${boardIds().join(", ")}.`,
    };
  }
  if (!Number.isInteger(pin) || pin < 0) {
    return { ok: false, reason: `GPIO ${pin} is not a valid pin number.` };
  }
  const pins = board.pins;
  if (pins.reserved.includes(pin)) {
    return {
      ok: false,
      reason:
        `GPIO ${pin} is reserved on ${board.name} (SPI flash/PSRAM). ` +
        `Assigning it will brick the firmware. Choose another pin.`,
    };
  }
  if (usage === "adc" && !pins.adc.includes(pin)) {
    return {
      ok: false,
      reason:
        `GPIO ${pin} is not ADC-capable on ${board.name}. ` +
        `ADC pins: ${pins.adc.join(", ")}.`,
    };
  }
  if (usage === "pwm") {
    if (!pins.digital.includes(pin)) {
      return {
        ok: false,
        reason: `GPIO ${pin} cannot do PWM output on ${board.name}.`,
      };
    }
    if (pins.inputOnly.includes(pin)) {
      return {
        ok: false,
        reason:
          `GPIO ${pin} is input-only on ${board.name}; it cannot drive PWM/output. ` +
          `Choose an output-capable pin.`,
      };
    }
  }
  if (usage === "digital" && !pins.digital.includes(pin)) {
    return {
      ok: false,
      reason:
        `GPIO ${pin} is not a usable GPIO on ${board.name}. ` +
        `Usable GPIOs: ${pins.digital.join(", ")}.`,
    };
  }
  if (pins.bootstrap.includes(pin)) {
    return {
      ok: true,
      warning:
        `GPIO ${pin} is a strapping pin on ${board.name}. ${pins.strappingNotes}`,
    };
  }
  return { ok: true };
}
