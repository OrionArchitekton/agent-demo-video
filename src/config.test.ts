import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("applies defaults (fps=30, resolution.width=1920) from minimal config", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = join(dir, "demo.config.json");
    writeFileSync(path, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://localhost:3000" }));
    const cfg = loadConfig(path);
    expect(cfg.fps).toBe(30);
    expect(cfg.resolution.width).toBe(1920);
  });

  it("throws an Error including the file path when dashboardBaseUrl is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = join(dir, "bad.config.json");
    writeFileSync(path, JSON.stringify({ script: "DEMO.md" }));
    expect(() => loadConfig(path)).toThrow(path);
  });
});
