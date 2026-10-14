import { describe, it, expect } from "vitest";
import { checkMotionRequirements, HYPERFRAMES_VERSION } from "./requirements";

const OFFICIAL = { version: "0.8.155", repository: { url: "git+https://github.com/heygen-com/hyperframes.git" } };

describe("checkMotionRequirements", () => {
  it("passes with the package present and Node 22.12+", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readPackageJson: () => OFFICIAL, fileExists: () => true, nodeVersion: "v22.12.0" });
    expect(r).toEqual({ ok: true, hyperframesBin: "/x/node_modules/hyperframes/bin/hyperframes.mjs", version: "0.8.155" });
  });
  it("names a missing package and how to install it next to agent-demo-video", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => { throw new Error("Cannot find module"); }, readPackageJson: () => OFFICIAL, fileExists: () => true, nodeVersion: "v22.12.0" });
    expect(r).toEqual({
      ok: false,
      problems: ['brand.motion needs the optional "hyperframes" package: hyperframes is not installed; install it next to agent-demo-video: npm install hyperframes@0.8.155'],
    });
    expect(JSON.stringify(r)).not.toMatch(/--no-optional/);
  });
  it("rejects any hyperframes version other than the pinned one", () => {
    expect(HYPERFRAMES_VERSION).toBe("0.8.155");
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readPackageJson: () => ({ ...OFFICIAL, version: "0.9.0" }), fileExists: () => true, nodeVersion: "v22.12.0" });
    expect(r).toEqual({
      ok: false,
      problems: ["brand.motion needs hyperframes 0.8.155 (found 0.9.0); install it next to agent-demo-video: npm install hyperframes@0.8.155"],
    });
  });
  it("names an old Node", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readPackageJson: () => OFFICIAL, fileExists: () => true, nodeVersion: "v20.11.1" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/Node 22\.12 or newer/);
  });
  it("requires Node 22.12 or newer (the HyperFrames browser installer needs it)", () => {
    const run = (nodeVersion: string) => checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readPackageJson: () => OFFICIAL, fileExists: () => true, nodeVersion });
    expect(run("v22.11.0").ok).toBe(false);
    expect(JSON.stringify(run("v22.11.0"))).toContain("brand.motion needs Node 22.12 or newer (running v22.11.0)");
    expect(run("v22.12.0").ok).toBe(true);
    expect(run("v23.0.0").ok).toBe(true);
    expect(run("v20.11.1").ok).toBe(false);
  });
  it("rejects a package that is not the official HeyGen one or lacks its bin", () => {
    const msg = 'the installed "hyperframes" package is not the official HeyGen package or is incomplete';
    const run = (pkg: { version: string; repository?: unknown }, exists: boolean) =>
      checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readPackageJson: () => pkg, fileExists: () => exists, nodeVersion: "v22.12.0" });
    const wrong = run({ version: "0.8.155", repository: "https://github.com/evil/hyperframes" }, true);
    expect(wrong.ok).toBe(false);
    expect(wrong).toEqual({ ok: false, problems: [msg] });
    expect(run({ version: "0.8.155" }, true)).toEqual({ ok: false, problems: [msg] });
    expect(run(OFFICIAL, false)).toEqual({ ok: false, problems: [msg] });
    expect(run({ version: "0.8.155", repository: "github:heygen-com/hyperframes" }, true).ok).toBe(true);
    expect(run(OFFICIAL, true).ok).toBe(true);
  });
});
