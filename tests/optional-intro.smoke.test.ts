import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { chmod, cp, mkdir, mkdtemp, open, readFile, readdir, writeFile, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ffmpeg, probeDeliverable } from "../src/ffmpeg";
import { digestFile } from "../src/provenance";
import { DemoConfigSchema } from "../src/types";
import { runPipeline } from "../src/pipeline";
import { LocalTransport } from "../src/transport";
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { prepareIntro, verifyIntro, withVerifiedIntro } from "../src/optional-intro";
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

it("substitutes a portrait scene while preserving the landscape capture's aspect guard", async () => {
  const portrait = join(root, "portrait.mp4");
  await ffmpeg(["-y", "-i", source, "-t", "4", "-vf", "scale=128:72,pad=180:320:26:124:color=white", "-c:v", "libx264", portrait]);
  const receipt = JSON.parse(await readFile(`${asset}.json`, "utf8"));
  await writeFile(`${portrait}.json`, JSON.stringify({ ...receipt, assetSha256: await digestFile(portrait), width: 180, height: 320 }));
  const cfg = config(join(root, "portrait-out"), { asset: portrait });
  cfg.platform = "shorts";
  cfg.resolution = { width: 180, height: 320 };
  cfg.capture.viewport = { width: 320, height: 180 };
  cfg.theme.frame.enabled = true;
  const result = await runPipeline(cfg);
  expect(result.report.optionalIntro?.used).toBe(true);
  expect(await probeDeliverable(result.outPath)).toMatchObject({ width: 180, height: 320, frameRate: "15/1" });
  const control = await runPipeline({ ...cfg, optionalIntro: undefined, out: join(root, "portrait-control") });
  expect(result.report.timeline).toEqual(control.report.timeline);
});

it("rejects source mutation even when the renderer fails before producing a candidate", async () => {
  const corrupt = join(root, "corrupt-source.mjs");
  await writeFile(corrupt, `import {chmod,writeFile} from 'node:fs/promises';
    await chmod(process.argv[2],0o600);await writeFile(process.argv[2],'changed source');process.exitCode=1;`);
  const cfg = config(join(root, "source-copy-corruption"), {
    renderer: [process.execPath, corrupt, "{source}", "{out}", "{receipt}"],
  });
  await expect(runPipeline(cfg)).rejects.toThrow(/source.*integrity/i);
  const raw = join(root, "mutable-source.mp4");
  await cp(source, raw);
  await expect(prepareIntro(config(join(root, "raw-source-corruption"), {
    renderer: [process.execPath, corrupt, raw, "{source}", "{out}", "{receipt}"],
  }), raw)).rejects.toThrow(/source.*integrity/i);
});

it("rejects staged symlinks and consumes the verified inode if the name changes afterward", async () => {
  const cfg = config(join(root, "staged-name"));
  const intro = (await prepareIntro(cfg, source))!;
  const link = join(intro.asset!.inputRoot, "link.mp4");
  await symlink(intro.asset!.path, link);
  await expect(verifyIntro({ ...intro, asset: { ...intro.asset!, path: link } }, source)).rejects.toThrow(/ELOOP|symbolic|symlink/);
  const captured: Buffer[] = [];
  await withVerifiedIntro(intro.asset!, async (input) => {
    await unlink(intro.asset!.path);
    await symlink(source, intro.asset!.path);
    for await (const chunk of input) captured.push(Buffer.from(chunk));
  });
  expect(Buffer.concat(captured)).toEqual(await readFile(asset));
});

it("rejects changed streamed bytes even when the original inode contents are restored", async () => {
  const intro = (await prepareIntro(config(join(root, "stream-content")), source))!;
  const original = await readFile(intro.asset!.path);
  const changed = Buffer.from(original);
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await expect(withVerifiedIntro(intro.asset!, async (input) => {
    await chmod(intro.asset!.path, 0o600);
    await writeFile(intro.asset!.path, changed);
    for await (const _ of input) { /* consume the changed bytes */ }
    await writeFile(intro.asset!.path, original);
  })).rejects.toThrow(/integrity/);
});

it("cancels an oversized renderer output before snapshotting it", async () => {
  const program = join(root, "oversized.mjs");
  await writeFile(program, `import {open} from 'node:fs/promises';
    const f=await open(process.argv[3],'w');await f.truncate(513*1024*1024);await f.close();setInterval(()=>{},1000);`);
  const cfg = config(join(root, "oversized-renderer"), {
    renderer: [process.execPath, program, "{source}", "{out}", "{receipt}"], timeoutSec: 2,
  });
  const result = await prepareIntro(cfg, source);
  expect(result?.record).toMatchObject({ used: false, fallbackReason: "asset_too_large" });
});

it("skips oversized sources and rejects oversized prepared assets without copying them", async () => {
  const huge = join(root, "oversized-input.mp4");
  const file = await open(huge, "wx");
  await file.truncate(513 * 1024 * 1024); // Sparse fixture: no large allocation.
  await file.close();
  expect((await prepareIntro(config(join(root, "source-limit")), huge))?.record.fallbackReason).toBe("source_too_large");
  const cfg = config(join(root, "candidate-limit"), { asset: huge });
  expect((await prepareIntro(cfg, source))?.record.fallbackReason).toBe("asset_too_large");
  const attempts = await readdir(join(cfg.out, "optional-intro"));
  await expect(readFile(join(cfg.out, "optional-intro", attempts[0]!, "intro.mp4"))).rejects.toThrow(/ENOENT/);
});

it("does not continue source hashing after the preparation deadline", async () => {
  const marker = join(root, "deadline-expired");
  const program = join(root, "expire-after-render.mjs");
  await writeFile(program, `import {copyFile,readFile,writeFile} from 'node:fs/promises';
    import {createHash} from 'node:crypto';
    const [source,out,receipt,request,candidate,marker]=process.argv.slice(2);
    const r=JSON.parse(await readFile(request,'utf8'));await copyFile(candidate,out);
    await writeFile(receipt,JSON.stringify({...r,assetSha256:createHash('sha256').update(await readFile(out)).digest('hex'),recipeId:'deadline-test'}));
    await writeFile(marker,'expired');`);
  const handle = await open(source, "r");
  const prototype = Object.getPrototypeOf(handle);
  const read = prototype.read;
  await handle.close();
  const now = Date.now.bind(Date), start = now();
  let readsAfterDeadline = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => existsSync(marker) ? start + 20_000 : now());
  const reader = vi.spyOn(prototype, "read").mockImplementation(function (this: any, ...args: any[]) {
    if (existsSync(marker)) readsAfterDeadline++;
    return read.apply(this, args);
  });
  try {
    const result = await prepareIntro(config(join(root, "deadline-source"), {
      renderer: [process.execPath, program, "{source}", "{out}", "{receipt}", "{request}", asset, marker], timeoutSec: 10,
    }), source);
    expect(result?.record.fallbackReason).toBe("renderer_timeout");
    expect(readsAfterDeadline).toBe(0);
  } finally { reader.mockRestore(); clock.mockRestore(); }
});

it("accepts an NTSC clip for a frame-aligned 29.97 fps request", async () => {
  const ntsc = join(root, "ntsc.mp4"), durationSec = 90 / 29.97;
  await ffmpeg(["-y", "-i", source, "-r", "30000/1001", "-frames:v", "90", "-an", "-c:v", "libx264", ntsc]);
  const receipt = JSON.parse(await readFile(`${asset}.json`, "utf8"));
  await writeFile(`${ntsc}.json`, JSON.stringify({ ...receipt, assetSha256: await digestFile(ntsc), fps: 30000 / 1001, durationSec }));
  const cfg = DemoConfigSchema.parse({ ...config(join(root, "ntsc-out")), fps: 29.97,
    optionalIntro: { asset: ntsc, durationSec } });
  const result = await runPipeline(cfg);
  expect(result.report.optionalIntro?.used).toBe(true);
  expect(result.report.parity.ok).toBe(true);
});

it("does not trust a renderer's read-only probe cache as candidate validation", async () => {
  const wrong = join(root, "cached-wrong-size.mp4");
  await ffmpeg(["-y", "-i", source, "-t", "4", "-vf", "scale=320:240,setsar=1", "-an", "-c:v", "libx264", wrong]);
  const program = join(root, "cached-probe.mjs");
  await writeFile(program, `import {copyFile,readFile,writeFile,chmod} from 'node:fs/promises';
    import {dirname,join} from 'node:path';import {createHash} from 'node:crypto';
    const [source,out,receipt,request,candidate]=process.argv.slice(2);const r=JSON.parse(await readFile(request,'utf8'));
    await copyFile(candidate,out);await writeFile(receipt,JSON.stringify({...r,assetSha256:createHash('sha256').update(await readFile(out)).digest('hex'),recipeId:'cached-probe-test'}));
    const cache=join(dirname(out),'probe.json');await writeFile(cache,JSON.stringify({streams:[{codec_type:'video',width:320,height:180,r_frame_rate:'15/1',avg_frame_rate:'15/1',sample_aspect_ratio:'1:1',duration:'4'}],format:{duration:'4'}}));await chmod(cache,0o400);`);
  const result = await prepareIntro(config(join(root, "probe-cache"), {
    renderer: [process.execPath, program, "{source}", "{out}", "{receipt}", "{request}", wrong],
  }), source);
  expect(result?.record).toMatchObject({ used: false, fallbackReason: "invalid_candidate" });
});
