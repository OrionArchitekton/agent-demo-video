import { describe, it, expect } from "vitest";
import { drawtextEscape, titleCardArgs, endCardArgs } from "./cards";

const O = {
  width: 1920, height: 1080, fps: 30, durationSec: 2.2, font: "Arial",
  backdropTop: "#101418", backdropBottom: "#1d2733", accent: "#3fb950",
  title: "Standing Questions", subtitle: "Ask once. It keeps watching.", url: "standing-questions.vercel.app",
};

describe("drawtextEscape", () => {
  it("escapes drawtext-significant characters", () => {
    const e = drawtextEscape("It's 100%: cool");
    expect(e.replace(/\\+'/g, "")).not.toContain("'");
    expect(e).toContain("\\%");
    expect(e).toContain("\\:");
  });
});

describe("cards", () => {
  it("title card renders gradient + title + subtitle with fades at the requested duration", () => {
    const j = titleCardArgs(O, "/t/title.mp4").join(" ");
    expect(j).toContain("gradients=");
    expect(j).toContain("drawtext");
    expect(j).toContain("Standing Questions");
    expect(j).toContain("fade=t=in");
    expect(j).toContain("fade=t=out");
    expect(j).toContain("2.2");
    expect(j).toContain("-an");
  });
  it("end card carries the url in the accent color", () => {
    const j = endCardArgs(O, "/t/end.mp4").join(" ");
    expect(j).toContain("standing-questions.vercel.app");
    expect(j.toLowerCase()).toContain("3fb950");
  });
});
