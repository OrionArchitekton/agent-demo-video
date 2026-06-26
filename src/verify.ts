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
