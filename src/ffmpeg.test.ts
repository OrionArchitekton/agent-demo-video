import { describe, it, expect } from "vitest";
import {
  normalizeArgs,
  concatArgs,
  concatListContent,
  concatListEntry,
  muxArgs,
  burnSubsArgs,
  subtitlesFilterPath,
  padAudioArgs,
  extendVideoArgs,
} from "./ffmpeg";

describe("ffmpeg arg builders", () => {
  it("normalize scales+pads to target and sets fps/h264", () => {
    const a = normalizeArgs("in.webm", "out.mp4", { width: 1920, height: 1080, fps: 30 });
    expect(a).toContain("-vf");
    expect(a.join(" ")).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(a.join(" ")).toContain("pad=1920:1080");
    expect(a.join(" ")).toContain("fps=30");
    expect(a).toContain("libx264");
    expect(a[a.length - 1]).toBe("out.mp4");
  });
  it("concat uses the demuxer with the list file", () => {
    expect(concatArgs("list.txt", "v.mp4").join(" ")).toContain("-f concat -safe 0 -i list.txt");
  });
  it("formats concat list paths with ffmpeg-safe single quote escaping", () => {
    expect(concatListEntry("/tmp/demo's/clip.mp4")).toBe("file '/tmp/demo'\\''s/clip.mp4'");
    expect(concatListContent(["/tmp/a.mp4", "/tmp/demo's/b.mp4"])).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/demo'\\''s/b.mp4'",
    );
  });
  it("rejects concat list paths with newlines", () => {
    expect(() => concatListEntry("/tmp/bad\nclip.mp4")).toThrow("cannot contain newlines");
  });
  it("escapes paths for ffmpeg's subtitles filter", () => {
    expect(subtitlesFilterPath("C:\\Users\\demo's\\captions.srt")).toBe("C\\:/Users/demo\\\\\\'s/captions.srt");
  });
  it("rejects subtitles filter paths with newlines", () => {
    expect(() => subtitlesFilterPath("/tmp/bad\ncaptions.srt")).toThrow("cannot contain newlines");
  });
  it("mux pairs video copy + aac audio, shortest", () => {
    const a = muxArgs("v.mp4", "a.mp3", "final.mp4").join(" ");
    expect(a).toContain("-c:v copy"); expect(a).toContain("-c:a aac"); expect(a).toContain("-shortest");
  });
  it("burn applies the subtitles filter", () => {
    expect(burnSubsArgs("v.mp4", "c.srt", "final.mp4").join(" ")).toContain("subtitles=c.srt");
  });
  it("padAudioArgs produces apad filter and -t duration", () => {
    const s = padAudioArgs("a.mp3", "o.mp3", 3).join(" ");
    expect(s).toContain("apad");
    expect(s).toContain("-t 3");
  });
  it("extendVideoArgs freezes the last frame for the requested seconds, re-encodes, drops audio", () => {
    const a = extendVideoArgs("seg.mp4", "ext.mp4", 5.6);
    const s = a.join(" ");
    expect(s).toContain("tpad=stop_mode=clone:stop_duration=5.6");
    expect(s).toContain("libx264");
    expect(a).toContain("-an");
    expect(a[a.length - 1]).toBe("ext.mp4");
  });
});

describe("normalizeArgs fade-in", () => {
  it("appends a fade-in filter when fadeInSec is set, without changing segment duration semantics", async () => {
    const { normalizeArgs } = await import("./ffmpeg");
    const args = normalizeArgs("in.webm", "out.mp4", { width: 1920, height: 1080, fps: 30, fadeInSec: 0.25 });
    const vf = args[args.indexOf("-vf") + 1]!;
    expect(vf).toContain("fade=t=in:st=0:d=0.25");
  });
  it("emits the exact legacy chain when fadeInSec is absent (backward compatible)", async () => {
    const { normalizeArgs } = await import("./ffmpeg");
    const args = normalizeArgs("in.webm", "out.mp4", { width: 1920, height: 1080, fps: 30 });
    const vf = args[args.indexOf("-vf") + 1]!;
    expect(vf).toBe("scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p");
  });
});

describe("filter path escaping of graph separators (pipeline finding)", () => {
  it("escapes comma, semicolon, and link-label brackets so a path cannot split the chain", () => {
    expect(subtitlesFilterPath("/a,b;c[d]/x.srt")).toBe("/a\\,b\\;c\\[d\\]/x.srt");
  });
});
