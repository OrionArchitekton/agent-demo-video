import { describe, it, expect } from "vitest";
import { checkDeliverable, checkTimelineBinding, verifyParity, type DeliverableProbe } from "./verify";

describe("checkTimelineBinding", () => {
  const timeline = {
    entries: [
      { shotId: "one", startSec: 0, durationSec: 3.466667 },
      { shotId: "two", startSec: 3.466667, durationSec: 2.3 },
    ],
    totalSec: 5.766667,
  };

  it("accepts the renderer's measured timeline for exactly the rendered shots", () => {
    expect(checkTimelineBinding(timeline, ["one", "two"])).toEqual([]);
  });

  it("rejects a timeline that omits, adds, or reorders shots", () => {
    expect(checkTimelineBinding({ entries: [timeline.entries[0]!], totalSec: 3.466667 }, ["one", "two"])).toEqual([
      expect.stringMatching(/^timeline shots: expected one, two; got one$/),
    ]);
    expect(checkTimelineBinding(timeline, ["two", "one"])[0]).toMatch(/^timeline shots: /);
  });

  it("rejects gaps, overlaps, non-positive durations, and a total that is not the last shot's end", () => {
    const shifted = { ...timeline, entries: [timeline.entries[0]!, { ...timeline.entries[1]!, startSec: 4 }] };
    expect(checkTimelineBinding(shifted, ["one", "two"])[0]).toMatch(/^timeline start of two: /);
    const zero = { ...timeline, entries: [timeline.entries[0]!, { ...timeline.entries[1]!, durationSec: 0 }] };
    expect(checkTimelineBinding(zero, ["one", "two"])).toContainEqual(expect.stringMatching(/^timeline duration of two: /));
    expect(checkTimelineBinding({ ...timeline, totalSec: 9 }, ["one", "two"])).toEqual([
      expect.stringMatching(/^timeline total: /),
    ]);
  });
});

const GOOD: DeliverableProbe = {
  videoStreams: 1,
  audioStreams: 1,
  videoCodec: "h264",
  pixFmt: "yuv420p",
  width: 1280,
  height: 720,
  frameRate: "30/1",
  avgFrameRate: "30/1",
  sampleAspectRatio: "1:1",
  audioCodec: "aac",
  durationSec: 5.766667,
  videoDurationSec: 5.766667,
  audioDurationSec: 5.758005,
  audioSampleRate: 44100,
};
const EXPECTED = { width: 1280, height: 720, fps: 30, totalSec: 5.766667 };

describe("checkDeliverable", () => {
  it("passes the measured contract of a real render", () => {
    expect(checkDeliverable(GOOD, EXPECTED)).toEqual({ ok: true, problems: [], probed: GOOD });
  });

  it.each([
    ["video streams", { videoStreams: 2 }],
    ["audio streams", { audioStreams: 0 }],
    ["video codec", { videoCodec: "hevc" }],
    ["pixel format", { pixFmt: "yuv444p" }],
    ["width", { width: 1920 }],
    ["height", { height: 1080 }],
    ["sample aspect ratio", { sampleAspectRatio: "4:3" }],
    ["audio codec", { audioCodec: "mp3" }],
    ["frame rate", { frameRate: "25/1" }],
    ["frame rate", { frameRate: null }],
    // r_frame_rate stays 30/1 on a variable-frame-rate file; the average does not.
    ["average frame rate", { avgFrameRate: "2250/139" }],
    ["average frame rate", { avgFrameRate: "0/0" }],
    ["duration", { durationSec: null }],
    // The container can outlast a video track that ended early.
    ["video duration", { videoDurationSec: 3.2 }],
    ["video duration", { videoDurationSec: null }],
    ["audio duration", { audioDurationSec: 4.2 }],
  ] as const)("names %s when it does not match", (name, patch) => {
    const r = checkDeliverable({ ...GOOD, ...patch }, EXPECTED);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(new RegExp(`^${name}: expected .*, got `));
  });

  it("reports every mismatch, not just the first", () => {
    const r = checkDeliverable({ ...GOOD, pixFmt: "yuv444p", frameRate: "25/1", audioCodec: "opus" }, EXPECTED);
    expect(r.problems.map((p) => p.split(":")[0])).toEqual(["pixel format", "audio codec", "frame rate"]);
  });

  it("bounds duration to one frame in BOTH directions", () => {
    const frame = 1 / 30;
    const at = (durationSec: number) => checkDeliverable({ ...GOOD, durationSec }, EXPECTED).ok;
    expect(at(EXPECTED.totalSec + frame)).toBe(true);
    expect(at(EXPECTED.totalSec - frame)).toBe(true);
    expect(at(EXPECTED.totalSec + frame * 1.5)).toBe(false);
    expect(at(EXPECTED.totalSec - frame * 1.5)).toBe(false);
  });

  it("bounds the video track to one frame either way, since the mux never trims it", () => {
    const frame = 1 / 30;
    const video = (videoDurationSec: number) => checkDeliverable({ ...GOOD, videoDurationSec }, EXPECTED);
    expect(video(EXPECTED.totalSec - frame).ok).toBe(true);
    expect(video(EXPECTED.totalSec + frame).ok).toBe(true);
    // A mux that dropped a B-frame group used to ship 2 to 4 frames short.
    expect(video(EXPECTED.totalSec - 2 * frame).problems).toEqual([expect.stringMatching(/^video duration: /)]);
    expect(video(EXPECTED.totalSec + 2 * frame).ok).toBe(false);
  });

  it("bounds the audio track so a truncated track fails even when the container is intact", () => {
    const audio = (audioDurationSec: number | null, fps = 30, totalSec = EXPECTED.totalSec) =>
      checkDeliverable(
        {
          ...GOOD,
          frameRate: `${fps}/1`,
          avgFrameRate: `${fps}/1`,
          durationSec: totalSec,
          videoDurationSec: totalSec,
          audioDurationSec,
        },
        { ...EXPECTED, fps, totalSec },
      );
    // Measured with the padded mux: audio ends 4.7 to 20.7ms early at 44.1kHz.
    expect(audio(EXPECTED.totalSec - 0.02074).ok).toBe(true);
    expect(audio(5.716666 - 0.01933, 120, 5.716666).ok).toBe(true);
    // A second of missing audio behind a full-length video must not pass.
    expect(audio(EXPECTED.totalSec - 1).problems).toEqual([expect.stringMatching(/^audio duration: /)]);
    expect(audio(0.1).ok).toBe(false);
    expect(audio(null).ok).toBe(false);
    // Late by more than one AAC frame at 120fps.
    expect(audio(5.716666 + 0.03, 120, 5.716666).ok).toBe(false);
  });

  it("bounds the container by one audio frame when that is longer than a video frame", () => {
    // Measured at 60fps with sound design off: AAC framing (1024 samples, 23.2ms at
    // 44.1kHz) left the container 18.35ms past the timeline, beyond one 16.7ms frame.
    const at60 = { ...EXPECTED, fps: 60, totalSec: 5.716666 };
    const container = (durationSec: number, audioSampleRate: number | null) =>
      checkDeliverable(
        { ...GOOD, frameRate: "60/1", avgFrameRate: "60/1", durationSec, videoDurationSec: at60.totalSec, audioDurationSec: at60.totalSec, audioSampleRate },
        at60,
      );
    expect(container(5.735011, 44100).ok).toBe(true);
    expect(container(at60.totalSec - 0.015, 44100).ok).toBe(true);
    expect(container(at60.totalSec + 0.03, 44100).problems).toEqual([expect.stringMatching(/^duration: /)]);
    expect(container(at60.totalSec - 0.03, 44100).ok).toBe(false);
    // Without a readable sample rate the window falls back to one video frame.
    expect(container(5.735011, null).ok).toBe(false);
  });

  it("accepts a non-integer configured fps expressed as a rational rate", () => {
    const r = checkDeliverable({ ...GOOD, frameRate: "2997/100", avgFrameRate: "2997/100" }, { ...EXPECTED, fps: 29.97 });
    expect(r.ok).toBe(true);
  });
});
describe("verifyParity", () => {
  it("passes when segment count matches and durations are within tolerance", () => {
    const r = verifyParity({ shotCount: 3, videoSegments: 3, audioSec: 30, videoSec: 30.2, maxSec: 300 });
    expect(r.ok).toBe(true);
  });
  it("fails on segment mismatch or overlength or A/V drift", () => {
    expect(verifyParity({ shotCount: 3, videoSegments: 2, audioSec: 30, videoSec: 30, maxSec: 300 }).ok).toBe(false);
    expect(verifyParity({ shotCount: 3, videoSegments: 3, audioSec: 30, videoSec: 30, maxSec: 25 }).ok).toBe(false);
    expect(verifyParity({ shotCount: 3, videoSegments: 3, audioSec: 30, videoSec: 33, maxSec: 300 }).ok).toBe(false);
  });
});
