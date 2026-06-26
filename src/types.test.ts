import { describe, it, expect } from "vitest";
import { ManifestSchema, DemoConfigSchema } from "./types";

describe("schemas", () => {
  it("parses a minimal manifest", () => {
    const m = { shots: [{ id: "s1", target: "dashboard", narration: "Hello.", actions: [{ kind: "goto", url: "/" }] }] };
    expect(ManifestSchema.parse(m).shots.length).toBe(1);
  });
  it("rejects an unknown action kind", () => {
    expect(() => ManifestSchema.parse({ shots: [{ id: "s1", target: "dashboard", narration: "x", actions: [{ kind: "bogus" }] }] })).toThrow();
  });
  it("parses a config with defaults applied", () => {
    const c = DemoConfigSchema.parse({ script: "DEMO.md", dashboardBaseUrl: "http://localhost:3000" });
    expect(c.fps).toBe(30); expect(c.resolution.width).toBe(1920);
    expect(c.captureCss).toBeUndefined();
  });
  it("parses optional captureCss when provided", () => {
    const c = DemoConfigSchema.parse({ script: "DEMO.md", dashboardBaseUrl: "http://localhost:3000", captureCss: ".feed{max-height:200px}" });
    expect(c.captureCss).toBe(".feed{max-height:200px}");
  });
});
