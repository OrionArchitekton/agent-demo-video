import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureLogin, captureShot } from "../src/capture";
import { runPipeline } from "../src/pipeline";
import { DemoConfigSchema } from "../src/types";

// Real Playwright, headless, against a local fixture — no human, no real creds, so it
// runs in CI. The OPERATOR (stdin Enter) confirm path is exercised manually, not here.
const appUrl = pathToFileURL(resolve("tests/fixtures/saas-app.html")).href;
const loggedOutUrl = pathToFileURL(resolve("tests/fixtures/page.html")).href; // no #app-shell

function liveCfg(profileDir: string) {
  return DemoConfigSchema.parse({
    script: "x",
    dashboardBaseUrl: "http://localhost:3000",
    resolution: { width: 1280, height: 720 },
    capture: {
      auth: {
        profileDir,
        loginUrl: appUrl,
        loggedInSelector: "#app-shell",
        confirmMode: "selector",
        headlessLogin: true,
        loginTimeoutMs: 15000,
      },
    },
  });
}

describe("auth-walled SaaS live capture (smoke)", () => {
  beforeAll(() => { process.env.FAKE_TTS = "1"; });

  it("captureLogin saves a persistent profile once the logged-in selector appears", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "advprof-"));
    const out = await captureLogin(liveCfg(profileDir));
    expect(out).toBe(profileDir);
    expect(existsSync(join(profileDir, "Default"))).toBe(true); // chromium profile dir
  }, 60_000);

  it("captureShot target:live records a webm driving the authed profile", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "advprof-"));
    await captureLogin(liveCfg(profileDir));
    const dir = await mkdtemp(join(tmpdir(), "advcap-"));
    const shot = { id: "L1", target: "live" as const, narration: "demo", actions: [
      { kind: "goto" as const, url: appUrl },
      { kind: "highlight" as const, selector: "#app-shell" },
    ] };
    const webm = await captureShot(shot, { shotId: "L1", startSec: 0, durationSec: 2 }, liveCfg(profileDir), dir);
    expect(webm.endsWith(".webm")).toBe(true);
    expect((await stat(webm)).size).toBeGreaterThan(0);
  }, 60_000);

  it("captureShot target:live fails CLOSED when the session is expired (logged-out wall)", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "advprof-"));
    await captureLogin(liveCfg(profileDir));
    const dir = await mkdtemp(join(tmpdir(), "advcap-"));
    const shot = { id: "L2", target: "live" as const, narration: "demo", actions: [
      { kind: "goto" as const, url: loggedOutUrl }, // page WITHOUT #app-shell
    ] };
    await expect(
      captureShot(shot, { shotId: "L2", startSec: 0, durationSec: 1 }, liveCfg(profileDir), dir),
    ).rejects.toThrow(/expired|log ?in/i);
  }, 60_000);

  it("captureShot target:live without a saved profile errors with a clear message", async () => {
    const profileDir = join(await mkdtemp(join(tmpdir(), "advprof-")), "missing");
    const dir = await mkdtemp(join(tmpdir(), "advcap-"));
    const shot = { id: "L3", target: "live" as const, narration: "demo", actions: [
      { kind: "goto" as const, url: appUrl },
    ] };
    await expect(
      captureShot(shot, { shotId: "L3", startSec: 0, durationSec: 1 }, liveCfg(profileDir), dir),
    ).rejects.toThrow(/profile|login/i);
  }, 60_000);

  it("captureShot target:live FAILS CLOSED by default when no loggedInSelector is set", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "advprof-"));
    await captureLogin(liveCfg(profileDir)); // make a profile (login uses the selector)
    const dir = await mkdtemp(join(tmpdir(), "advcap-"));
    // A config WITHOUT loggedInSelector and without the explicit unguarded opt-in.
    const noSelector = DemoConfigSchema.parse({
      script: "x",
      dashboardBaseUrl: "http://localhost:3000",
      resolution: { width: 640, height: 360 },
      capture: { auth: { profileDir, loginUrl: appUrl } },
    });
    const shot = { id: "L4", target: "live" as const, narration: "demo", actions: [
      { kind: "goto" as const, url: appUrl },
    ] };
    await expect(
      captureShot(shot, { shotId: "L4", startSec: 0, durationSec: 1 }, noSelector, dir),
    ).rejects.toThrow(/loggedInSelector|allowUnguardedLiveCapture/i);
  }, 60_000);

  it("captureShot target:live rejects a shot that does not begin with a goto (auth-before-actions)", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "advprof-"));
    await captureLogin(liveCfg(profileDir));
    const dir = await mkdtemp(join(tmpdir(), "advcap-"));
    const shot = { id: "L5", target: "live" as const, narration: "demo", actions: [
      { kind: "wait" as const, ms: 100 },          // a non-goto FIRST action
      { kind: "goto" as const, url: appUrl },
    ] };
    await expect(
      captureShot(shot, { shotId: "L5", startSec: 0, durationSec: 1 }, liveCfg(profileDir), dir),
    ).rejects.toThrow(/must begin with a "goto"/i);
  }, 60_000);

  it("runPipeline renders final.mp4 end-to-end from a single live shot (normalize/mux/parity)", async () => {
    const profileDir = await mkdtemp(join(tmpdir(), "advprof-"));
    await captureLogin(liveCfg(profileDir));
    const work = await mkdtemp(join(tmpdir(), "advpipe-"));
    const scriptPath = join(work, "demo.md");
    await writeFile(
      scriptPath,
      `# Live\n### SHOT one\n- target: live\n- narration: A short authenticated walkthrough of the workspace shell.\n- action: goto url="${appUrl}"\n- action: highlight selector="#app-shell"\n`,
    );
    const cfg = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(work, "out"),
      resolution: { width: 640, height: 360 },
      capture: { auth: { profileDir, loginUrl: appUrl, loggedInSelector: "#app-shell", confirmMode: "selector", headlessLogin: true } },
    });
    const r = await runPipeline(cfg);
    expect(r.outPath.endsWith("final.mp4")).toBe(true);
    expect((await stat(r.outPath)).size).toBeGreaterThan(0);
    expect(r.report.parity.ok).toBe(true);
  }, 120_000);
});
