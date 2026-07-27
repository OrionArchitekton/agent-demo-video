import { describe, it, expect } from "vitest";
import { scaledSize, windowSize, maskGenArgs, shadowGenArgs, frameArgs, assertFramedContentAspect } from "./framing";

const O = {
  width: 1920,
  height: 1080,
  scale: 0.86,
  radius: 24,
  backdropTop: "#101418",
  backdropBottom: "#1d2733",
  shadow: true,
};

describe("scaledSize", () => {
  it("scales to even dimensions (h264 yuv420 requires them)", () => {
    const s = scaledSize(1920, 1080, 0.86);
    expect(s.width % 2).toBe(0);
    expect(s.height % 2).toBe(0);
    expect(s.width).toBeCloseTo(1920 * 0.86, -1);
  });
});

describe("windowSize", () => {
  it("keeps the content aspect inside a portrait canvas (no bars inside the window)", () => {
    const o = { ...O, width: 1080, height: 1920, content: { width: 1920, height: 1080 } };
    expect(windowSize(o)).toEqual({ width: 928, height: 522 });
    expect(maskGenArgs(o, "/tmp/mask.png").join(" ")).toContain("928x522");
    const framed = frameArgs("in.mp4", "/m.png", "/s.png", "out.mp4", { ...o, fps: 30, durationSec: 12 }).join(" ");
    expect(framed).toContain("scale=928:522");
  });
  it("is exactly the scaled box when content matches the canvas aspect", () => {
    expect(windowSize({ ...O, content: { width: 1920, height: 1080 } })).toEqual(scaledSize(1920, 1080, 0.86));
    expect(windowSize(O)).toEqual(scaledSize(1920, 1080, 0.86));
  });
});

describe("assertFramedContentAspect", () => {
  const decoupled = { ...O, width: 1080, height: 1920, content: { width: 1920, height: 1080 } };
  it("rejects an aspect-mismatched framed clip when the window is decoupled from the canvas", () => {
    expect(() => assertFramedContentAspect(decoupled, { width: 1080, height: 1920 }, "intro")).toThrow(/fullBleed/);
    expect(() => assertFramedContentAspect(decoupled, { width: 1080, height: 1920 }, "intro")).toThrow(/intro/);
  });
  it("accepts viewport-matching geometry, including encoder even-rounding jitter and same-aspect resizes", () => {
    expect(() => assertFramedContentAspect(decoupled, { width: 1920, height: 1080 }, "a")).not.toThrow();
    expect(() => assertFramedContentAspect(decoupled, { width: 1918, height: 1080 }, "a")).not.toThrow();
    expect(() => assertFramedContentAspect(decoupled, { width: 1280, height: 720 }, "a")).not.toThrow();
  });
  it("rejects a near-aspect clip that would still show real bars (tolerance is rounding slack, not 2%)", () => {
    expect(() => assertFramedContentAspect(decoupled, { width: 1900, height: 1080 }, "b")).toThrow(/fullBleed/);
  });
  it("never throws when content matches the canvas aspect or is absent (landscape compat)", () => {
    expect(() => assertFramedContentAspect({ ...O, content: { width: 1920, height: 1080 } }, { width: 1080, height: 1920 }, "a")).not.toThrow();
    expect(() => assertFramedContentAspect(O, { width: 1080, height: 1920 }, "a")).not.toThrow();
  });
});

describe("maskGenArgs / shadowGenArgs", () => {
  it("generates a one-frame rounded-rect alpha mask at the scaled size", () => {
    const args = maskGenArgs(O, "/tmp/mask.png").join(" ");
    expect(args).toContain("-frames:v 1");
    expect(args).toContain("geq=");
    expect(args).toContain(`${scaledSize(1920, 1080, 0.86).width}x${scaledSize(1920, 1080, 0.86).height}`);
    expect(args).toContain("/tmp/mask.png");
  });
  it("generates a blurred shadow plate on a larger canvas", () => {
    const args = shadowGenArgs(O, "/tmp/shadow.png").join(" ");
    expect(args).toContain("boxblur");
    expect(args).toContain("/tmp/shadow.png");
  });
});

describe("frameArgs", () => {
  it("composites gradient backdrop, shadow, and masked window centered, ending CFR", () => {
    const args = frameArgs("in.mp4", "/m.png", "/s.png", "out.mp4", { ...O, fps: 30, durationSec: 12 });
    const joined = args.join(" ");
    expect(joined).toContain("gradients=");
    expect(joined).toContain("0x101418");
    expect(joined).toContain("0x1d2733");
    expect(joined).toContain("alphamerge");
    expect(joined).toContain("overlay");
    expect(joined).toContain("fps=30");
    expect(joined).toContain("-an");
  });
  it("omits the shadow input when disabled and appends fade-in when requested", () => {
    const args = frameArgs("in.mp4", "/m.png", null, "out.mp4", { ...O, shadow: false, fps: 30, durationSec: 12, fadeInSec: 0.25 });
    const joined = args.join(" ");
    expect(joined).not.toContain("/s.png");
    expect(joined).toContain("fade=t=in:st=0:d=0.25");
  });
});
