import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpeg } from "../src/ffmpeg";
import { renderVideo, type RenderInputs } from "../src/render";
import { renderRemote } from "../src/remote-render";
import { LocalTransport, SshTransport, type Transport } from "../src/transport";
import { assertEquivalent } from "../src/equivalence";

function hashInputs(inputs: RenderInputs): string[] {
  const paths = [...inputs.rawSegments, ...inputs.tts.map((t) => t.audioPath)];
  return paths.map((p) => createHash("sha256").update(readFileSync(p)).digest("hex"));
}

const BUNDLE = resolve("dist-remote/remote-entry.js");

/** Synthetic render inputs (no Playwright/TTS): 2 tiny testsrc segments + sine audio. */
async function makeInputs(dir: string): Promise<RenderInputs> {
  const segDir = join(dir, "seg");
  const audioDir = join(dir, "audio");
  mkdirSync(segDir, { recursive: true });
  mkdirSync(audioDir, { recursive: true });
  const rawSegments: string[] = [];
  const tts: RenderInputs["tts"] = [];
  for (let i = 0; i < 2; i++) {
    const seg = join(segDir, `raw_${i}.mp4`);
    await ffmpeg(["-y", "-f", "lavfi", "-i", `testsrc=duration=2:size=320x240:rate=15`, "-pix_fmt", "yuv420p", "-c:v", "libx264", seg]);
    const audio = join(audioDir, `n_${i}.mp3`);
    await ffmpeg(["-y", "-f", "lavfi", "-i", `sine=frequency=${300 + i * 100}:duration=2`, "-c:a", "libmp3lame", audio]);
    rawSegments.push(seg);
    tts.push({
      shotId: `shot_${i}`,
      audioPath: audio,
      durationSec: 2.0,
      alignment: { chars: ["H", "i", " ", String(i)], startSec: [0, 0.5, 1.0, 1.4], endSec: [0.5, 1.0, 1.4, 1.9] },
    });
  }
  return {
    rawSegments,
    tts,
    config: {
      resolution: { width: 320, height: 240 },
      fps: 15,
      theme: {
        captionFont: "Liberation Sans",
        captionSize: 24,
        cursor: true,
        captionBox: true,
        captionMarginV: 20,
        annotations: { enabled: true, durationMs: 500, fontSize: 24, position: "top-right" as const },
      },
      out: dir,
    },
  };
}

describe("remote render parity", () => {
  beforeAll(() => {
    execSync("pnpm build:remote-entry", { stdio: "ignore" });
  });

  it("renders on a render host (localhost transport) equivalently to a local render", async () => {
    const localBase = mkdtempSync(join(tmpdir(), "adv-local-"));
    const inputs = await makeInputs(localBase);

    // baseline: render in-process
    const local = await renderVideo(inputs);

    // remote: same inputs, shipped + rendered via the bundle on the "render host"
    const remoteOut = join(mkdtempSync(join(tmpdir(), "adv-out-")), "final.mp4");
    const returned = await renderRemote(inputs, {
      transport: new LocalTransport(),
      bundlePath: BUNDLE,
      workDir: join(tmpdir(), "adv-remote-" + Date.now() + "-" + Math.random().toString(36).slice(2)),
      outPath: remoteOut,
    });

    expect(returned.outPath).toBe(remoteOut);
    expect(returned.report.segments).toBe(2);
    expect(existsSync(remoteOut)).toBe(true);

    const eq = await assertEquivalent(local.outPath, remoteOut);
    expect(eq.problems).toEqual([]);
    expect(eq.ok).toBe(true);
    expect(eq.ssim).toBeGreaterThanOrEqual(0.98);
  }, 120000);

  it("fails loudly (named step) and leaves the local inputs byte-unchanged when the host is unreachable", async () => {
    const base = mkdtempSync(join(tmpdir(), "adv-safe-"));
    const inputs = await makeInputs(base);
    const before = hashInputs(inputs);

    await expect(
      renderRemote(inputs, {
        transport: new SshTransport("no-such-host.invalid"),
        bundlePath: BUNDLE,
        workDir: "/tmp/adv-render-unreachable",
        outPath: join(base, "final.mp4"),
      }),
    ).rejects.toThrow(/\[remote-render\]/); // every step throws a named [remote-render] error

    expect(hashInputs(inputs)).toEqual(before); // inputs byte-identical, not just same size
    expect(existsSync(join(base, "final.mp4"))).toBe(false); // no output produced on failure
  }, 60000);

  it("cleans up the remote work dir even when the render step fails (no leaked captured media)", async () => {
    const base = mkdtempSync(join(tmpdir(), "adv-clean-"));
    const inputs = await makeInputs(base);
    const calls: string[] = [];
    // A transport whose exec (the render step) fails after the dir is created.
    const failing: Transport = {
      describe: () => "failing",
      mkdirExclusive: async () => void calls.push("mkdirExclusive"),
      pushDir: async () => void calls.push("pushDir"),
      exec: async () => {
        calls.push("exec");
        throw new Error("[remote-render] ssh exec exited 1: boom");
      },
      capture: async () => "Liberation Sans", // font preflight passes (matches local)
      pullFile: async () => void calls.push("pullFile"),
      remove: async () => void calls.push("remove"),
    };

    await expect(
      renderRemote(inputs, { transport: failing, bundlePath: BUNDLE, workDir: "/tmp/adv-clean-work", outPath: join(base, "final.mp4") }),
    ).rejects.toThrow(/\[remote-render\]/);

    expect(calls).toContain("remove"); // cleanup ran despite the exec failure
  }, 60000);

  it("refuses a work dir that already exists (never deletes a caller's dir on cleanup)", async () => {
    const base = mkdtempSync(join(tmpdir(), "adv-exist-"));
    const inputs = await makeInputs(base);
    const existing = mkdtempSync(join(tmpdir(), "adv-preexisting-")); // a real, pre-existing dir
    await expect(
      renderRemote(inputs, { transport: new LocalTransport(), bundlePath: BUNDLE, workDir: existing, outPath: join(base, "final.mp4") }),
    ).rejects.toThrow(/already exists/);
    expect(existsSync(existing)).toBe(true); // pre-existing dir left intact
  }, 60000);
});
