import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg, probeDeliverable } from "../src/ffmpeg";
import { digestFile } from "../src/provenance";
import { DemoConfigSchema } from "../src/types";
import { runPipeline } from "../src/pipeline";
import { LocalTransport } from "../src/transport";
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { prepareIntro } from "../src/optional-intro";
import { buildManifest, loadManifest } from "../src/manifest";
import { renderVideo, type RenderInputs, type RenderResult } from "../src/render";
import { assertEquivalent } from "../src/equivalence";

let root: string;
let source: string;
let asset: string;
beforeAll(async () => {
  vi.stubEnv("FAKE_TTS", "1");
  root = await mkdtemp(join(tmpdir(), "adv-intro-test-"));
  source = join(root, "source.mp4");
  asset = join(root, "hero.mp4");
  await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15:duration=5", "-c:v", "libx264", source]);
  // Synthetic scene fixture, visibly distinct from the control. Not a 3D proof.
  await ffmpeg(["-y", "-i", source, "-t", "4", "-vf", "scale=256:144,pad=320:180:32:18:color=white", "-c:v", "libx264", asset]);
  await writeFile(`${asset}.json`, JSON.stringify({
    version: 1, sourceSha256: await digestFile(source), sourceStartSec: 0,
    durationSec: 4, assetSha256: await digestFile(asset), width: 320, height: 180,
    fps: 15, recipeId: "synthetic-test-v1",
  }));
  await writeFile(join(root, "demo.md"), `# Synthetic fixture\n### SHOT first\n- target: prebaked\n- clip: ${source}\n- narration: This synthetic fixture checks the opening and the original captions.\n`);
});
afterAll(() => vi.unstubAllEnvs());

function config(out: string, intro: unknown = { asset }) {
  return DemoConfigSchema.parse({
    script: join(root, "demo.md"), dashboardBaseUrl: "http://localhost:3000", out,
    resolution: { width: 320, height: 180 }, fps: 15, preflight: false,
    audio: { soundDesign: false }, theme: { frame: { enabled: false }, captions: "block" },
    optionalIntro: intro,
  });
}

let candidateResult: RenderResult | undefined;
async function candidate() {
  return candidateResult ??= await runPipeline(config(join(root, "candidate")));
}

it("substitutes a receipted first-shot interval without adding time or moving narration", async () => {
  const out = join(root, "candidate");
  const result = await candidate();
  const report = JSON.parse(await readFile(join(out, "render-report.json"), "utf8"));
  expect(report.optionalIntro).toMatchObject({ requested: true, used: true, asset: {
    sha256: await digestFile(asset), recipeId: "synthetic-test-v1", durationSec: 4,
    sourceSha256: await digestFile(source),
  } });
  expect(result.report.segments).toBe(1);
  expect(result.report.timeline.entries[0]?.shotId).toBe("first");
  expect(result.report.timeline.totalSec).toBeCloseTo(5, 1);
  const delivered = await probeDeliverable(result.outPath);
  expect(delivered.frameRate).toBe("15/1");
  expect(delivered.videoDurationSec).toBeCloseTo(5, 1);
  expect(report.deliverable.ok).toBe(true);
  expect(report.lookCheck.state).toBe("unavailable");
  expect(await readFile(join(out, "captions.srt"), "utf8")).toContain("This synthetic");
});

it("stages the same intro identity for remote rendering and rejects tampered staged bytes", async () => {
  await candidate();
  execFileSync("pnpm", ["build:remote-entry"], { stdio: "ignore" });
  class InspectTransport extends LocalTransport {
    tamper = false;
    override async exec(cwd: string, cmd: string[]) {
      const manifest = JSON.parse(await readFile(join(cwd, "manifest.json"), "utf8"));
      expect(manifest.optionalIntro.asset.file).toBe("optional/intro.mp4");
      expect(JSON.stringify(manifest.optionalIntro)).not.toContain(root);
      if (this.tamper) {
        await chmod(join(cwd, "optional/intro.mp4"), 0o600);
        await writeFile(join(cwd, "optional/intro.mp4"), "changed in transport");
      }
      return super.exec(cwd, cmd);
    }
  }
  const transport = new InspectTransport();
  const out = join(root, "remote");
  const remote = await runPipeline(config(out), { render: { transport,
    bundlePath: resolve("dist-remote/remote-entry.js") } });
  const localReport = JSON.parse(await readFile(join(root, "candidate", "render-report.json"), "utf8"));
  expect(remote.report.optionalIntro).toEqual(localReport.optionalIntro);
  expect(remote.report.timeline).toEqual(localReport.timeline);
  expect((await assertEquivalent(join(root, "candidate", "final.mp4"), remote.outPath)).ok).toBe(true);
  transport.tamper = true;
  await expect(runPipeline(config(join(root, "tampered")), { render: { transport } }))
    .rejects.toThrow(/integrity/);
});

it("keeps off, missing-tool, title-card, short-source and rejected-candidate paths on their original shots", async () => {
  const noTool = config(join(root, "missing"), {});
  const checker = join(root, "dark-checker.mjs");
  await writeFile(checker, "console.log(JSON.stringify({profile:'motion',passed:false,metrics:{motion_pct:0,contrast:0,luma_mean:0,secs_measured:Number(process.argv[2])}}));process.exitCode=1;");
  noTool.lookCheck = { command: [process.execPath, checker, "{duration}", "{video}", "{start}", "{profile}"], timeoutSec: 5 };
  const missing = await runPipeline(noTool);
  expect(missing.report.optionalIntro?.fallbackReason).toBe("missing_renderer");
  const attempts = await import("node:fs/promises").then(({ readdir }) => readdir(join(noTool.out, "optional-intro")));
  expect(JSON.parse(await readFile(join(noTool.out, "optional-intro", attempts[0]!, "preparation.json"), "utf8")).fallbackReason)
    .toBe("missing_renderer");
  const diagnostics = JSON.parse(await readFile(join(noTool.out, "render-report.json"), "utf8"));
  expect(diagnostics.lookCheck.state).toBe("fail");
  expect(diagnostics.deliverable.ok).toBe(true);
  expect(diagnostics.contactSheet.stills).toHaveLength(1);
  const off = config(join(root, "control"));
  delete off.optionalIntro;
  const control = await runPipeline(off);
  expect(control.report.optionalIntro).toBeUndefined();
  expect((await assertEquivalent(control.outPath, missing.outPath)).ok).toBe(true);
  const unavailable = await prepareIntro(config(join(root, "unavailable"), {
    renderer: ["/nonexistent/scene-tool", "{source}", "{out}", "{receipt}"],
  }), source);
  expect(unavailable?.record.fallbackReason).toBe("renderer_unavailable");
  const withTitle = config(join(root, "title"), { renderer: ["/must-not-run", "{source}", "{out}", "{receipt}"] });
  withTitle.brand = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "x", brand: { title: "Fixture" } }).brand;
  const titled = await runPipeline(withTitle);
  expect(titled.report.optionalIntro?.fallbackReason).toBe("title_card_enabled");
  expect(titled.report.timeline.entries.map((e) => e.shotId)).toEqual(["__card-title", "first", "__card-end"]);
  const short = join(root, "short.mp4");
  await ffmpeg(["-y", "-i", source, "-t", "2", "-c", "copy", short]);
  expect((await prepareIntro(config(join(root, "short"), { renderer: ["/must-not-run", "{source}", "{out}", "{receipt}"] }), short))?.record.fallbackReason)
    .toBe("source_too_short");
  for (const [name, text] of [["corrupt", "invalid media"], ["wrong-receipt", "{}"]] as const) {
    const invalid = join(root, name);
    await writeFile(invalid, text);
    const choice = name === "corrupt" ? { asset: invalid } : { asset, receipt: invalid };
    expect((await prepareIntro(config(join(root, name + "-out"), choice), source))?.record)
      .toMatchObject({ used: false, fallbackReason: "invalid_candidate" });
  }
  for (const [name, vf, duration] of [["short-candidate", "null", "2"], ["wrong-size", "scale=320:240", "4"]]) {
    const invalid = join(root, `${name}.mp4`);
    await ffmpeg(["-y", "-i", source, "-t", duration!, "-vf", vf!, "-c:v", "libx264", invalid]);
    const receipt = JSON.parse(await readFile(`${asset}.json`, "utf8"));
    await writeFile(`${invalid}.json`, JSON.stringify({ ...receipt, assetSha256: await digestFile(invalid) }));
    expect((await prepareIntro(config(join(root, name + "-out"), { asset: invalid }), source))?.record.fallbackReason)
      .toBe("invalid_candidate");
  }
  // Visual replacement is limited to the opening; decode actual delivered pixels.
  const corner = (video: string, sec: number) => execFileSync("ffmpeg", ["-v", "error", "-ss", String(sec), "-i", video,
    "-frames:v", "1", "-vf", "crop=16:16:0:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const candidatePath = (await candidate()).outPath;
  expect([...corner(candidatePath, 0)].every((value) => value > 230)).toBe(true);
  const tailA = corner(candidatePath, 4.5), tailB = corner(control.outPath, 4.5);
  expect([...tailA].reduce((sum, v, i) => sum + Math.abs(v - tailB[i]!), 0) / tailA.length).toBeLessThan(4);
});

it("rejects escaping or missing staged inputs and never overwrites a completed opted-in output", async () => {
  await candidate();
  const cfg = config(join(root, "integrity"));
  const optionalIntro = (await prepareIntro(cfg, source))!;
  const inputs: RenderInputs = { rawSegments: [source], tts: [], config: cfg, optionalIntro };
  const manifest = buildManifest(inputs);
  manifest.optionalIntro!.asset!.file = "../outside.mp4" as any;
  expect(() => loadManifest(manifest, root)).toThrow();
  const outside = join(optionalIntro.asset!.inputRoot, "escape.mp4");
  await symlink(asset, outside);
  const escaped = { ...optionalIntro, asset: { ...optionalIntro.asset!, path: outside } };
  await expect(renderVideo({ ...inputs, optionalIntro: escaped })).rejects.toThrow(/escapes/);
  const gone = { ...optionalIntro, asset: { ...optionalIntro.asset!, path: join(optionalIntro.asset!.inputRoot, "gone.mp4") } };
  await expect(renderVideo({ ...inputs, optionalIntro: gone })).rejects.toThrow(/ENOENT/);
  const before = await digestFile(join(root, "candidate", "final.mp4"));
  await expect(runPipeline(config(join(root, "candidate")))).rejects.toThrow(/exist|fresh/i);
  expect(await digestFile(join(root, "candidate", "final.mp4"))).toBe(before);
});

it("rejects non-frame-aligned intervals and nonregular staged media before encoding", async () => {
  expect(() => config(join(root, "bad-interval"), { asset, durationSec: 3.1 })).toThrow(/frame/);
  const cfg = config(join(root, "not-file"));
  const optionalIntro = (await prepareIntro(cfg, source))!;
  const directory = join(optionalIntro.asset!.inputRoot, "folder");
  await mkdir(directory);
  await expect(renderVideo({ rawSegments: [source], tts: [], config: cfg,
    optionalIntro: { ...optionalIntro, asset: { ...optionalIntro.asset!, path: directory } },
  })).rejects.toThrow(/regular|integrity/);
});

it("uses a bounded argv renderer and retains a timeout fallback without touching unrelated processes", async () => {
  const script = join(root, "renderer.mjs");
  await writeFile(script, `import {copyFile,readFile,writeFile} from 'node:fs/promises';
    import {createHash} from 'node:crypto';
    const [source,out,receipt,candidate,request] = process.argv.slice(2);
    const r = JSON.parse(await readFile(request,'utf8'));
    await copyFile(candidate,out);
    await writeFile(receipt,JSON.stringify({...r,assetSha256:createHash('sha256').update(await readFile(out)).digest('hex'),recipeId:'fake-renderer-v1'}));`);
  const command = [process.execPath, script, "{source}", "{out}", "{receipt}", asset, "{request}"];
  const out = join(root, "command");
  const result = await runPipeline(config(out, { renderer: command, timeoutSec: 10 }));
  expect(result.report.optionalIntro).toMatchObject({ used: true, asset: { recipeId: "fake-renderer-v1" } });
  const hang = join(root, "hang.mjs");
  await writeFile(hang, "setInterval(() => {}, 1000);");
  const cfg = config(join(root, "timeout"), { renderer: [process.execPath, hang, "{source}", "{out}", "{receipt}"], timeoutSec: 1 });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  try {
    const fallback = await runPipeline(cfg);
    expect(fallback.report.optionalIntro).toMatchObject({ requested: true, used: false, fallbackReason: "renderer_timeout" });
    expect(fallback.report.timeline.totalSec).toBeCloseTo(5, 1);
    expect(process.kill(unrelated.pid!, 0)).toBe(true);
  } finally { unrelated.kill(); }
});
