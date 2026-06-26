import { describe, it, expect } from "vitest";
import { verifyParity } from "./verify";
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
