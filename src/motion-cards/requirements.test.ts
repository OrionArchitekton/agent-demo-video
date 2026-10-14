import { describe, it, expect } from "vitest";
import { checkMotionRequirements, HYPERFRAMES_VERSION } from "./requirements";

describe("checkMotionRequirements", () => {
  it("passes with the package present and Node 22+", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readVersion: () => "0.8.155", nodeVersion: "v22.3.0" });
    expect(r).toEqual({ ok: true, hyperframesBin: "/x/node_modules/hyperframes/bin/hyperframes.mjs", version: "0.8.155" });
  });
  it("names a missing package and how to install it next to agent-demo-video", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => { throw new Error("Cannot find module"); }, readVersion: () => "", nodeVersion: "v22.3.0" });
    expect(r).toEqual({
      ok: false,
      problems: ['brand.motion needs the optional "hyperframes" package: hyperframes is not installed; install it next to agent-demo-video: npm install hyperframes@0.8.155'],
    });
    expect(JSON.stringify(r)).not.toMatch(/--no-optional/);
  });
  it("rejects any hyperframes version other than the pinned one", () => {
    expect(HYPERFRAMES_VERSION).toBe("0.8.155");
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readVersion: () => "0.9.0", nodeVersion: "v22.3.0" });
    expect(r).toEqual({
      ok: false,
      problems: ["brand.motion needs hyperframes 0.8.155 (found 0.9.0); install it next to agent-demo-video: npm install hyperframes@0.8.155"],
    });
  });
  it("names an old Node", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readVersion: () => "0.8.155", nodeVersion: "v20.11.1" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/Node 22 or newer/);
  });
});
