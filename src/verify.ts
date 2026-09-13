const AV_DRIFT_TOLERANCE_SEC = 1.5;

export function verifyParity(opts: {
  shotCount: number;
  videoSegments: number;
  audioSec: number;
  videoSec: number;
  maxSec: number;
}): { ok: boolean; problems: string[] } {
  const { shotCount, videoSegments, audioSec, videoSec, maxSec } = opts;
  const problems: string[] = [];

  if (videoSegments !== shotCount) {
    problems.push(`video segment count ${videoSegments} does not match shot count ${shotCount}`);
  }
  if (videoSec > maxSec) {
    problems.push(`video duration ${videoSec}s exceeds max ${maxSec}s`);
  }
  if (Math.abs(audioSec - videoSec) > AV_DRIFT_TOLERANCE_SEC) {
    problems.push(`A/V drift ${Math.abs(audioSec - videoSec).toFixed(3)}s exceeds tolerance ${AV_DRIFT_TOLERANCE_SEC}s`);
  }

  return { ok: problems.length === 0, problems };
}

/** What the encoded deliverable actually is, read from the file with ffprobe. */
export type DeliverableProbe = {
  videoStreams: number;
  audioStreams: number;
  videoCodec: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  /** ffprobe r_frame_rate as written ("30/1"); null when absent or unparseable. */
  frameRate: string | null;
  /** ffprobe avg_frame_rate: frames over time. Unlike r_frame_rate it moves when
   *  a variable-frame-rate file drops or holds frames. */
  avgFrameRate: string | null;
  sampleAspectRatio: string | null;
  audioCodec: string | null;
  /** Container duration. */
  durationSec: number | null;
  /** The video stream's own duration; a container can outlast its video track. */
  videoDurationSec: number | null;
  /** The audio stream's own duration; a container can outlast a truncated audio track. */
  audioDurationSec: number | null;
  /** Audio sample rate in Hz; an AAC frame is 1024 samples at this rate. */
  audioSampleRate: number | null;
};

/** Samples per AAC frame; the audio track's duration is quantized to it. */
const AAC_FRAME_SAMPLES = 1024;

export type DeliverableCheck = { ok: boolean; problems: string[]; probed: DeliverableProbe };

const FRAME_RATE_EPSILON = 1e-3;
const DURATION_FLOAT_EPSILON = 1e-6;

function frameRateValue(rate: string | null): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(rate ?? "");
  if (!m) return null;
  const den = Number(m[2]);
  return den > 0 ? Number(m[1]) / den : null;
}

/**
 * The deliverable contract (specs/deliverable-verification-spec.md): compare what
 * the encoded file IS against what the config declares it must be. Every
 * property is checked and every mismatch reported, so one failure never hides
 * another. Every duration bound is two-sided against the measured timeline: the
 * video track within one frame, the audio track and container within their AAC
 * framing (see the windows below).
 */
export function checkDeliverable(
  probed: DeliverableProbe,
  expected: { width: number; height: number; fps: number; totalSec: number },
): DeliverableCheck {
  const problems: string[] = [];
  const want = (name: string, actual: unknown, exp: unknown) => {
    if (actual !== exp) problems.push(`${name}: expected ${String(exp)}, got ${String(actual)}`);
  };

  want("video streams", probed.videoStreams, 1);
  want("audio streams", probed.audioStreams, 1);
  want("video codec", probed.videoCodec, "h264");
  want("pixel format", probed.pixFmt, "yuv420p");
  want("width", probed.width, expected.width);
  want("height", probed.height, expected.height);
  want("sample aspect ratio", probed.sampleAspectRatio, "1:1");
  want("audio codec", probed.audioCodec, "aac");

  const rateMatches = (name: string, raw: string | null) => {
    const rate = frameRateValue(raw);
    if (rate === null || Math.abs(rate - expected.fps) > FRAME_RATE_EPSILON) {
      problems.push(`${name}: expected ${expected.fps}, got ${String(raw)}`);
    }
  };
  rateMatches("frame rate", probed.frameRate);
  rateMatches("average frame rate", probed.avgFrameRate);

  const frameSec = 1 / expected.fps;
  const withinWindow = (name: string, actual: number | null, earlySec: number, lateSec: number) => {
    const delta = actual === null ? NaN : actual - expected.totalSec;
    if (
      !Number.isFinite(delta) ||
      delta < -(earlySec + DURATION_FLOAT_EPSILON) ||
      delta > lateSec + DURATION_FLOAT_EPSILON
    ) {
      problems.push(
        `${name}: expected ${expected.totalSec}s from ${earlySec.toFixed(6)}s early to ${lateSec.toFixed(6)}s late, got ${String(actual)}`,
      );
    }
  };

  // The container ends with its longest track. With the padded mux that is the
  // video (measured exact); one video frame or one audio frame of slack, whichever
  // is longer, either way, covers files muxed before the pad and AAC framing.
  const rate = probed.audioSampleRate;
  const audioFrameSec = rate !== null && Number.isFinite(rate) && rate > 0 ? AAC_FRAME_SAMPLES / rate : 0;
  const containerSec = Math.max(frameSec, audioFrameSec);
  withinWindow("duration", probed.durationSec, containerSec, containerSec);

  // The mux pads the audio so the video always ends the file (muxArgs); the video
  // track is therefore frame-exact, measured at 0ms across 23.976 to 120fps.
  withinWindow("video duration", probed.videoDurationSec, frameSec, frameSec);

  // The audio track ends on an AAC frame boundary before the video (measured up to
  // 23ms early at 44.1kHz, 20ms at 48kHz, 40ms at 22.05kHz; never late): one audio
  // frame of quantization plus up to one frame of encoder priming offset early, one
  // audio frame late. A delivered track a second short still fails.
  withinWindow("audio duration", probed.audioDurationSec, Math.max(frameSec, 2 * audioFrameSec), containerSec);

  return { ok: problems.length === 0, problems, probed };
}
