import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContactSheet, planContactSheet } from "../src/contact-sheet";

// Real ffmpeg against a small generated video: the contact sheet is judged by
// the pixels it wrote, not by its geometry alone.
const FPS = 30;
const RES = { width: 320, height: 180 };
let video = "";

function ffmpegSync(args: string[]): Buffer {
  return execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
}

function pixelRgb(png: string, x: number, y: number): string {
  const raw = ffmpegSync(["-i", png, "-vf", `crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
  return raw.subarray(0, 3).toString("hex");
}

function entries(n: number, durationSec: number) {
  return Array.from({ length: n }, (_, i) => ({ shotId: `s${i}`, startSec: i * durationSec, durationSec }));
}

describe("buildContactSheet (real ffmpeg)", () => {
  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "cs-video-"));
    video = join(dir, "clip.mp4");
    ffmpegSync(["-f", "lavfi", "-i", `testsrc2=size=${RES.width}x${RES.height}:rate=${FPS}:duration=4`, "-pix_fmt", "yuv420p", video]);
  });

  it("never tiles stills left in a reused out dir by an earlier, longer render", async () => {
    const out = await mkdtemp(join(tmpdir(), "cs-stale-"));
    const plan = planContactSheet(entries(5, 0.8), FPS, RES);
    expect({ columns: plan.columns, rows: plan.rows }).toEqual({ columns: 4, rows: 2 });
    // An earlier 8-shot render left pure-red stills at every index.
    await mkdir(join(out, "contact-sheet"), { recursive: true });
    for (let i = 0; i < 8; i++) {
      ffmpegSync([
        "-f", "lavfi", "-i", `color=c=red:s=${plan.tile.width}x${plan.tile.height}`,
        "-frames:v", "1", "-update", "1",
        join(out, "contact-sheet", `still_${String(i).padStart(3, "0")}.png`),
      ]);
    }

    await buildContactSheet(video, out, plan);

    // Slot 8 (column 4, row 2) has no shot: it must be background, not red.
    const x = 8 + 3 * (plan.tile.width + 8) + plan.tile.width / 2;
    const y = 8 + 1 * (plan.tile.height + 8) + plan.tile.height / 2;
    expect(pixelRgb(join(out, plan.path), x, y)).toBe("111111");
    expect((await readdir(join(out, "contact-sheet"))).sort()).toEqual(plan.stills.map((s) => s.path.split("/")[1]));
  }, 60_000);

  it("rejects a beat that yields no frame instead of tiling around the gap", async () => {
    const out = await mkdtemp(join(tmpdir(), "cs-gap-"));
    const plan = planContactSheet(
      [
        { shotId: "inside", startSec: 0, durationSec: 2 },
        { shotId: "past-end", startSec: 10, durationSec: 2 },
      ],
      FPS,
      RES,
    );
    await expect(buildContactSheet(video, out, plan)).rejects.toThrow(/still .*past-end.*(missing|no frame)/);
  }, 60_000);

  it("treats an out dir containing % as a literal path", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "cs-pct-")), "run%d");
    await mkdir(out);
    const plan = planContactSheet(entries(2, 1.5), FPS, RES);
    await buildContactSheet(video, out, plan);
    expect((await readdir(out)).sort()).toEqual(["contact-sheet", "contact-sheet.png"]);
  }, 60_000);
});
