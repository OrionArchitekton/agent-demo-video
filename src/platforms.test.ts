import { describe, expect, it } from "vitest";
import { DemoConfigSchema } from "./types";
import { captureViewport } from "./platforms";

const base = { script: "demo.md", dashboardBaseUrl: "http://localhost:3000" };

describe("platform presets", () => {
  it("shorts derives a portrait canvas and a desktop capture viewport", () => {
    const cfg = DemoConfigSchema.parse({ ...base, platform: "shorts" });
    expect(cfg.resolution).toEqual({ width: 1080, height: 1920 });
    expect(captureViewport(cfg)).toEqual({ width: 1920, height: 1080 });
  });

  it("default/landscape keeps the coupled geometry existing configs rely on", () => {
    const cfg = DemoConfigSchema.parse(base);
    expect(cfg.platform).toBe("landscape");
    expect(cfg.resolution).toEqual({ width: 1920, height: 1080 });
    expect(captureViewport(cfg)).toEqual({ width: 1920, height: 1080 });
    // Landscape viewport follows an explicit custom resolution, as today.
    const custom = DemoConfigSchema.parse({ ...base, resolution: { width: 1280, height: 720 } });
    expect(captureViewport(custom)).toEqual({ width: 1280, height: 720 });
  });

  it("rejects fractional, zero, and negative canvas or viewport dimensions", () => {
    expect(() => DemoConfigSchema.parse({ ...base, resolution: { width: 1920.5, height: 1080 } })).toThrow();
    expect(() => DemoConfigSchema.parse({ ...base, resolution: { width: 0, height: 1080 } })).toThrow();
    expect(() => DemoConfigSchema.parse({ ...base, capture: { viewport: { width: -1920, height: 1080 } } })).toThrow();
    expect(() => DemoConfigSchema.parse({ ...base, capture: { viewport: { width: 1920, height: 1080.25 } } })).toThrow();
  });

  it("explicit resolution and viewport each override the preset independently", () => {
    const cfg = DemoConfigSchema.parse({
      ...base,
      platform: "shorts",
      resolution: { width: 720, height: 1280 },
      capture: { viewport: { width: 1440, height: 900 } },
    });
    expect(cfg.resolution).toEqual({ width: 720, height: 1280 });
    expect(captureViewport(cfg)).toEqual({ width: 1440, height: 900 });
  });
});
