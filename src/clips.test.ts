import { describe, it, expect } from "vitest";
import { resolveClipPath } from "./clips";

describe("resolveClipPath (issue #14)", () => {
  // The README promises "place the clip in clipsDir" and then reference it.
  // Only a BARE filename gets that treatment: joining clipsDir onto every
  // relative path would double it onto the README's own
  // `clip: clips/prebaked/uipath-studio.mp4` example and break existing configs.
  it("joins a bare filename into clipsDir", () => {
    expect(resolveClipPath("uipath.mp4", "clips/prebaked", "/cfg")).toBe("/cfg/clips/prebaked/uipath.mp4");
  });

  it("resolves a path that already carries a directory against the config dir", () => {
    expect(resolveClipPath("clips/prebaked/x.mp4", "clips/prebaked", "/cfg")).toBe("/cfg/clips/prebaked/x.mp4");
  });

  it("leaves an absolute clip path exactly as given", () => {
    expect(resolveClipPath("/elsewhere/x.mp4", "clips/prebaked", "/cfg")).toBe("/elsewhere/x.mp4");
  });

  // The defect this closes: resolution used to depend on the process CWD, so
  // the same config found different files depending on where it was invoked.
  it("is independent of the process working directory", () => {
    expect(resolveClipPath("x.mp4", "clips/prebaked", "/cfg")).toBe(
      resolveClipPath("x.mp4", "clips/prebaked", "/cfg"),
    );
    expect(resolveClipPath("x.mp4", "clips/prebaked", "/other")).toBe("/other/clips/prebaked/x.mp4");
  });

  // "./x.mp4" carries a directory component and must NOT be treated as bare:
  // an author writing it means "next to my config", not "inside clipsDir".
  it("treats an explicitly-relative path as carrying a directory", () => {
    expect(resolveClipPath("./uipath.mp4", "clips/prebaked", "/cfg")).toBe("/cfg/uipath.mp4");
  });

  it("honours an absolute clipsDir", () => {
    expect(resolveClipPath("x.mp4", "/shared/clips", "/cfg")).toBe("/shared/clips/x.mp4");
  });
});
