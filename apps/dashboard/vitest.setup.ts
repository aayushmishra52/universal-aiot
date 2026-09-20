import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// @testing-library/react's auto-cleanup hooks into the global afterEach,
// which doesn't exist when vitest runs with globals: false.
afterEach(() => {
  cleanup();
});
