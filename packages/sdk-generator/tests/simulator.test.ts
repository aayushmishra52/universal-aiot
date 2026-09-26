import { describe, expect, it } from "vitest";
import { runSimulatorTest } from "../src/simulator.js";
import { buildManifest } from "../src/generate/manifest.js";
import { goldenInput } from "./render.test.js";

describe("simulator round-trip", () => {
  it("passes the full telemetry + command round-trip", async () => {
    const manifest = buildManifest(goldenInput());
    const result = await runSimulatorTest(manifest, {
      orgId: "org-golden",
      projectId: "project-golden",
      timeoutMs: 15000,
    });
    for (const c of result.checks) {
      expect(c.passed, `${c.name}: ${c.detail ?? ""}`).toBe(true);
    }
    expect(result.passed).toBe(true);
    const names = result.checks.map((c) => c.name);
    expect(names).toContain("command_roundtrip");
    expect(names).toContain("manifest_roundtrip");
  }, 30000);
});
