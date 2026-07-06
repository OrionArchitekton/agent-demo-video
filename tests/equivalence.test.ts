import { describe, it, expect } from "vitest";
import { parseVideoMeta, parseSsimAll } from "../src/equivalence";

describe("parseVideoMeta", () => {
  it("extracts structural facts from ffprobe json (duration, dims, fps, codecs, stream count)", () => {
    const probe = {
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1" },
        { codec_type: "audio", codec_name: "aac" },
      ],
      format: { duration: "5.234" },
    };
    expect(parseVideoMeta(probe)).toEqual({
      durationSec: 5.234,
      width: 1280,
      height: 720,
      fps: 30,
      vcodec: "h264",
      acodec: "aac",
      streamCount: 2,
    });
  });

  it("evaluates fractional avg_frame_rate (e.g. 30000/1001 -> ~29.97)", () => {
    const probe = {
      streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001" }],
      format: { duration: "1.0" },
    };
    expect(parseVideoMeta(probe).fps).toBeCloseTo(29.97, 2);
  });
});

describe("parseSsimAll", () => {
  it("reads the All: SSIM value from the ffmpeg ssim filter summary line", () => {
    const stderr =
      "[Parsed_ssim_0 @ 0x556] SSIM Y:0.998833 (29.316) U:0.997001 (25.2) V:0.997114 (25.4) All:0.998455 (28.109)\n";
    expect(parseSsimAll(stderr)).toBeCloseTo(0.998455, 6);
  });

  it("throws a clear error when no SSIM line is present (rather than returning a false-high value)", () => {
    expect(() => parseSsimAll("some unrelated ffmpeg output\n")).toThrow(/SSIM/i);
  });
});
