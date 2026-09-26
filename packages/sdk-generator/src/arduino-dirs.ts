/**
 * Sketchbook directory resolution.
 *
 * The generated sketch.yaml references the pinned libraries by directory
 * (`- dir: <sketchbook>/libraries/<name>`), so the generator and `repair`
 * must agree on where the sketchbook lives. This module is intentionally
 * dependency-free (no imports from commands/ or generate/) so both sides
 * can use it without import cycles.
 */
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Conventional sketchbook location when arduino-cli is unavailable.
 * Matches arduino-cli's own defaults: ~/Arduino on Linux/macOS,
 * ~/Documents/Arduino on Windows.
 */
export function defaultSketchbookDir(): string {
  return process.platform === "win32"
    ? join(homedir(), "Documents", "Arduino")
    : join(homedir(), "Arduino");
}

/** Conventional libraries dir: <sketchbook>/libraries. */
export function defaultLibraryDir(): string {
  return join(defaultSketchbookDir(), "libraries");
}
