import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
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

  it("resolves capture.auth.profileDir to an absolute outside-repo path by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = join(dir, "demo.config.json");
    writeFileSync(path, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://x", capture: { auth: { loginUrl: "https://app/login" } } }));
    const cfg = loadConfig(path);
    expect(cfg.capture.auth).toBeDefined();
    expect(isAbsolute(cfg.capture.auth!.profileDir!)).toBe(true);
    expect(cfg.capture.auth!.profileDir!).toContain("agent-demo-video");
  });

  it("leaves a config without capture.auth untouched (back-compat)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = join(dir, "demo.config.json");
    writeFileSync(path, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://x" }));
    const cfg = loadConfig(path);
    expect(cfg.capture.auth).toBeUndefined();
  });
});

describe("relative dashboardBaseUrl", () => {
  it("resolves a ./ base against the config file's directory as a file:// URL", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadConfig } = await import("./config");
    const dir = mkdtempSync(join(tmpdir(), "adv-cfg-"));
    const p = join(dir, "demo.config.json");
    writeFileSync(p, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "./site" }));
    const cfg = loadConfig(p);
    expect(cfg.dashboardBaseUrl).toBe(`file://${join(dir, "site")}`);
  });
});
