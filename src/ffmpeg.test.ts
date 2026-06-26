import { describe, it, expect } from "vitest";
import { normalizeArgs, concatArgs, muxArgs, burnSubsArgs, padAudioArgs } from "./ffmpeg";

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
});
