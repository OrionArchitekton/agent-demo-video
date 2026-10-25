import { expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLookCheck } from "./look-check";
import { DemoConfigSchema } from "./types";

it("records a dark static whole film, intro and body as advisory failure without a fabricated pass", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-test-"));
  const checker = join(dir, "checker.mjs");
  await writeFile(checker, `console.log(JSON.stringify({profile:'motion',passed:false,metrics:{motion_pct:0,contrast:0,luma_mean:0,secs_measured:Number(process.argv[2])}}));process.exitCode=1;`);
  const cfg = DemoConfigSchema.parse({ script: "demo.md", dashboardBaseUrl: "http://localhost:3000",
    lookCheck: { command: [process.execPath, checker, "{duration}", "{video}", "{start}", "{profile}"] } });
  const result = await runLookCheck("unused-by-fake.mp4", cfg, 5, 4, dir);
  expect(result.state).toBe("fail");
  expect(result.windows.map((w) => [w.name, w.startSec, w.durationSec, w.state]))
    .toEqual([["complete", 0, 5, "fail"], ["intro", 0, 4, "fail"], ["body", 4, 1, "fail"]]);
  const absent = await runLookCheck("video.mp4", { ...cfg, lookCheck: undefined }, 5, undefined, dir);
  expect(absent.state).toBe("unavailable");
});

it("refuses partial, malformed or nonzero checker results as passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-look-invalid-"));
  for (const [name, body, state] of [
    ["partial", "console.log(JSON.stringify({profile:'motion',passed:true,metrics:{motion_pct:100,contrast:200,luma_mean:100,secs_measured:1}}))", "unavailable"],
    ["malformed", "console.log('not metrics')", "unavailable"],
    ["nonzero", "console.log(JSON.stringify({profile:'motion',passed:true,metrics:{motion_pct:100,contrast:200,luma_mean:100,secs_measured:5}}));process.exitCode=1", "fail"],
  ]) {
    const program = join(dir, `${name}.mjs`);
    await writeFile(program, body!);
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "x", lookCheck: {
      command: [process.execPath, program, "{video}", "{start}", "{duration}", "{profile}"] } });
    expect((await runLookCheck("x.mp4", cfg, 5, undefined, join(dir, name!))).state).toBe(state);
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
  expect((await runLookCheck("x.mp4", cfg, 5, undefined, dir)).state).toBe("unavailable");
});
