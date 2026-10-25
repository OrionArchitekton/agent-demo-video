import { expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLookCheck } from "./look-check";
import { DemoConfigSchema } from "./types";

async function fixtureVideo(dir: string): Promise<string> {
  const video = join(dir, "fixture.mp4");
  await writeFile(video, "fixture bytes for checker-adapter tests");
  return video;
}

it("records a dark static whole film, intro and body as advisory failure without a fabricated pass", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-test-"));
  const checker = join(dir, "checker.mjs");
  await writeFile(checker, `console.log(JSON.stringify({profile:'motion',passed:false,metrics:{motion_pct:0,contrast:0,luma_mean:0,secs_measured:Number(process.argv[2])}}));process.exitCode=1;`);
  const cfg = DemoConfigSchema.parse({ script: "demo.md", dashboardBaseUrl: "http://localhost:3000",
    lookCheck: { command: [process.execPath, checker, "{duration}", "{video}", "{start}", "{profile}"] } });
  const result = await runLookCheck(await fixtureVideo(dir), cfg, 5, 4, dir);
  expect(result.state).toBe("fail");
  expect(result.windows.map((w) => [w.name, w.startSec, w.durationSec, w.state]))
    .toEqual([["complete", 0, 5, "fail"], ["intro", 0, 4, "fail"], ["body", 4, 1, "fail"]]);
  const absent = await runLookCheck("video.mp4", { ...cfg, lookCheck: undefined }, 5, undefined, dir);
  expect(absent.state).toBe("unavailable");
});

it("refuses partial, malformed or nonzero checker results as passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-invalid-"));
  const video = await fixtureVideo(dir);
  for (const [name, body, state] of [
    ["partial", "console.log(JSON.stringify({profile:'motion',passed:true,metrics:{motion_pct:100,contrast:200,luma_mean:100,secs_measured:1}}))", "unavailable"],
    ["malformed", "console.log('not metrics')", "unavailable"],
    ["nonzero", "console.log(JSON.stringify({profile:'motion',passed:true,metrics:{motion_pct:100,contrast:200,luma_mean:100,secs_measured:5}}));process.exitCode=1", "fail"],
  ]) {
    const program = join(dir, `${name}.mjs`);
    await writeFile(program, body!);
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "x", lookCheck: {
      command: [process.execPath, program, "{video}", "{start}", "{duration}", "{profile}"] } });
    expect((await runLookCheck(video, cfg, 5, undefined, join(dir, name!))).state).toBe(state);
  }
});

it("never reuses a previous checker result when the current attempt emits no metrics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-stale-"));
  await mkdir(join(dir, "look-check"));
  const previous = join(dir, "look-check", "complete.log");
  await writeFile(previous, JSON.stringify({ profile: "motion", passed: true,
    metrics: { motion_pct: 100, contrast: 200, luma_mean: 100, secs_measured: 5 } }));
  await chmod(previous, 0o400);
  const program = join(dir, "no-metrics.mjs");
  await writeFile(program, "void 0;");
  const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "x", lookCheck: {
    command: [process.execPath, program, "{video}", "{start}", "{duration}", "{profile}"] } });
  expect((await runLookCheck(await fixtureVideo(dir), cfg, 5, undefined, dir)).state).toBe("unavailable");
});

it("binds metrics to the requested window and preserves a complete failure on timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-window-"));
  const video = await fixtureVideo(dir);
  for (const [name, metrics, passed, hang, expected] of [
    ["wrong-window", { motion_pct: 100, contrast: 200, luma_mean: 100, secs_measured: 10 }, true, false, "unavailable"],
    ["below-floors", { motion_pct: 29, contrast: 99, luma_mean: 49, secs_measured: 5 }, true, false, "fail"],
    ["timeout-verdict", { motion_pct: 0, contrast: 0, luma_mean: 0, secs_measured: 5 }, false, true, "fail"],
    ["timeout-pass", { motion_pct: 100, contrast: 200, luma_mean: 100, secs_measured: 5 }, true, true, "fail"],
  ] as const) {
    const program = join(dir, `${name}.mjs`);
    await writeFile(program, `console.log(${JSON.stringify(JSON.stringify({ profile: "motion", passed, metrics }))});${hang ? "setInterval(()=>{},1000);" : ""}`);
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "x", lookCheck: {
      command: [process.execPath, program, "{video}", "{start}", "{duration}", "{profile}"], timeoutSec: 1 } });
    expect((await runLookCheck(video, cfg, 5, undefined, join(dir, name))).state).toBe(expected);
  }
});

it("accepts all three complete windows at the motion-profile floors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-pass-"));
  const checker = join(dir, "pass.mjs");
  await writeFile(checker, "console.log(JSON.stringify({profile:'motion',passed:true,metrics:{motion_pct:30,contrast:100,luma_mean:50,secs_measured:Number(process.argv[2])}}));");
  const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "x", lookCheck: {
    command: [process.execPath, checker, "{duration}", "{video}", "{start}", "{profile}"] } });
  const result = await runLookCheck(await fixtureVideo(dir), cfg, 5, 4, dir);
  expect(result.state).toBe("pass");
  expect(result.windows.map((w) => w.state)).toEqual(["pass", "pass", "pass"]);
});

it("gives a faulty checker a separate snapshot and rejects metrics for changed input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-copy-"));
  const video = join(dir, "final.mp4"), checker = join(dir, "overwrite.mjs");
  await writeFile(video, "original delivered bytes");
  await writeFile(checker, `import {chmod,writeFile} from 'node:fs/promises';
    await chmod(process.argv[2],0o600);await writeFile(process.argv[2],'overwritten');
    console.log(JSON.stringify({profile:'motion',passed:true,metrics:{motion_pct:100,contrast:200,luma_mean:100,secs_measured:5}}));`);
  const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "x", lookCheck: {
    command: [process.execPath, checker, "{video}", "{start}", "{duration}", "{profile}"] } });
  const result = await runLookCheck(video, cfg, 5, undefined, dir);
  expect(await readFile(video, "utf8")).toBe("original delivered bytes");
  expect(result.state).toBe("unavailable");
});

it("fails rather than certifying a delivered file changed by a checker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-deliverable-"));
  const video = join(dir, "final.mp4"), checker = join(dir, "overwrite-original.mjs");
  await writeFile(video, "original delivered bytes");
  await writeFile(checker, `import {writeFile} from 'node:fs/promises';await writeFile(process.argv[3],'changed');`);
  const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "x", lookCheck: {
    command: [process.execPath, checker, "{video}", video, "{start}", "{duration}", "{profile}"] } });
  await expect(runLookCheck(video, cfg, 5, undefined, dir)).rejects.toThrow(/delivered video.*changed/i);
});
