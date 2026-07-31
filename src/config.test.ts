import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  // Prebaked clip paths used to resolve against the PROCESS CWD, so the same
  // config found different files depending on where the pipeline was invoked
  // from. Pinning the config file's own directory is what removes that.
  it("records the config file's directory, independent of the process CWD", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-dir-"));
    const path = join(dir, "demo.config.json");
    writeFileSync(path, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://localhost:3000" }));

    const fromHere = loadConfig(path);
    const cwd = process.cwd();
    let fromElsewhere;
    try {
      process.chdir(tmpdir());
      fromElsewhere = loadConfig(path);
    } finally {
      process.chdir(cwd);
    }

    expect(isAbsolute(fromHere.configDir!)).toBe(true);
    expect(fromElsewhere.configDir).toBe(fromHere.configDir);
  });

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

  it("rejects an unrecognised key and names it, at the top level and nested", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const top = join(dir, "top.config.json");
    writeFileSync(top, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://x", theem: {} }));
    expect(() => loadConfig(top)).toThrow(/theem/);

    // The real-world shape: a typo in the remedy for a known defect. `baseZom`
    // silently applied the 1.08 default that crops ~4% off every edge.
    const nested = join(dir, "nested.config.json");
    writeFileSync(nested, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://x", motion: { baseZom: 1.02 } }));
    expect(() => loadConfig(nested)).toThrow(/baseZom/);
  });

  it("defaults maxDurationSec to 300 and honours a declared shorter cap", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const def = join(dir, "default.config.json");
    writeFileSync(def, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://x" }));
    expect(loadConfig(def).maxDurationSec).toBe(300);

    // Events ship against caps shorter than the default (2:00, 3:00).
    const capped = join(dir, "capped.config.json");
    writeFileSync(capped, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://x", maxDurationSec: 120 }));
    expect(loadConfig(capped).maxDurationSec).toBe(120);
  });

  it("leaves a config without capture.auth untouched (back-compat)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = join(dir, "demo.config.json");
    writeFileSync(path, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "http://x" }));
    const cfg = loadConfig(path);
    expect(cfg.capture.auth).toBeUndefined();
  });

  it("lets an artifact-first video suppress only the opening brand card", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = join(dir, "demo.config.json");
    writeFileSync(path, JSON.stringify({
      script: "DEMO.md",
      dashboardBaseUrl: "http://x",
      brand: {
        title: "Produced by AI, directed and reviewed by Dan Mercede",
        cards: true,
        titleCard: false,
        endCard: true,
      },
    }));

    const cfg = loadConfig(path);

    expect(cfg.brand?.titleCard).toBe(false);
    expect(cfg.brand?.endCard).toBe(true);
  });

  it("keeps the legacy brand.cards switch as the default for both cards", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const enabledPath = join(dir, "enabled.config.json");
    const disabledPath = join(dir, "disabled.config.json");
    const base = { script: "DEMO.md", dashboardBaseUrl: "http://x" };
    writeFileSync(enabledPath, JSON.stringify({ ...base, brand: { title: "Demo" } }));
    writeFileSync(disabledPath, JSON.stringify({ ...base, brand: { title: "Demo", cards: false } }));

    expect(loadConfig(enabledPath).brand).toMatchObject({ titleCard: true, endCard: true });
    expect(loadConfig(disabledPath).brand).toMatchObject({ titleCard: false, endCard: false });
  });

  it("resolves each partial brand-card override independently", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const titleOffPath = join(dir, "title-off.config.json");
    const endOnPath = join(dir, "end-on.config.json");
    const base = { script: "DEMO.md", dashboardBaseUrl: "http://x" };
    writeFileSync(titleOffPath, JSON.stringify({
      ...base,
      brand: { title: "Demo", cards: true, titleCard: false },
    }));
    writeFileSync(endOnPath, JSON.stringify({
      ...base,
      brand: { title: "Demo", cards: false, endCard: true },
    }));

    expect(loadConfig(titleOffPath).brand).toMatchObject({ titleCard: false, endCard: true });
    expect(loadConfig(endOnPath).brand).toMatchObject({ titleCard: false, endCard: true });
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

describe("relative base with URL-significant characters", () => {
  it("produces a valid file URL even when the config dir contains spaces", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadConfig } = await import("./config");
    const base = mkdtempSync(join(tmpdir(), "adv cfg "));
    mkdirSync(join(base, "site"), { recursive: true });
    const p = join(base, "demo.config.json");
    writeFileSync(p, JSON.stringify({ script: "DEMO.md", dashboardBaseUrl: "./site" }));
    const cfg = loadConfig(p);
    expect(cfg.dashboardBaseUrl).toMatch(/^file:\/\//);
    expect(cfg.dashboardBaseUrl).not.toContain(" ");
    expect(decodeURIComponent(cfg.dashboardBaseUrl)).toContain("site");
  });
});
