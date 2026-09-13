import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg, muxArgs } from "../src/ffmpeg";

// Real ffmpeg: the mux must never drop trailing video frames. With a stream-copied
// B-frame video and `-shortest`, an audio track only a few ms short made ffmpeg end
// the video early (measured: 449 frames muxed to 446, and 4 frames on a real 24fps
// render), shaving the end of the closing shot.
const FPS = 24;
const FRAMES = 449;
let dir = "";
let video = "";
let audio = "";

function probe(file: string, entries: string, stream?: string): string {
  return execFileSync("ffprobe", [
    "-v", "error", ...(stream ? ["-select_streams", stream] : []),
    ...(entries.includes("nb_read_packets") ? ["-count_packets"] : []),
    "-show_entries", entries, "-of", "csv=p=0", file,
  ], { encoding: "utf8" }).trim();
}

describe("muxArgs (real ffmpeg)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mux-trim-"));
    video = join(dir, "video.mp4");
    audio = join(dir, "audio.mp3");
    execFileSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=${FPS}`,
      "-frames:v", String(FRAMES), "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      video,
    ]);
    // 8ms shorter than the 18.708333s video.
    execFileSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "18.70", "-c:a", "libmp3lame",
      audio,
    ]);
  }, 60_000);

  it("keeps every video frame when the audio ends a few ms early", async () => {
    expect(probe(video, "stream=has_b_frames", "v:0")).toBe("2");
    const out = join(dir, "muxed.mp4");
    await ffmpeg(muxArgs(video, audio, out));
    expect(Number(probe(out, "stream=nb_read_packets", "v:0"))).toBe(FRAMES);
    // The container ends with the video, not with a trimmed or overlong track.
    expect(Math.abs(Number(probe(out, "format=duration")) - FRAMES / FPS)).toBeLessThanOrEqual(1 / FPS);
  }, 60_000);
});
