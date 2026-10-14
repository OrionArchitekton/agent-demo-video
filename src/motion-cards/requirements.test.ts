import { describe, it, expect } from "vitest";
import { checkMotionRequirements } from "./requirements";

describe("checkMotionRequirements", () => {
  it("passes with the package present and Node 22+", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readVersion: () => "0.8.155", nodeVersion: "v22.3.0" });
    expect(r).toEqual({ ok: true, hyperframesBin: "/x/node_modules/hyperframes/bin/hyperframes.mjs", version: "0.8.155" });
  });
  it("names a missing package and how to install it", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => { throw new Error("Cannot find module"); }, readVersion: () => "", nodeVersion: "v22.3.0" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/hyperframes is not installed/);
  });
  it("names an old Node", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readVersion: () => "0.8.155", nodeVersion: "v20.11.1" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/Node 22 or newer/);
  });
});
