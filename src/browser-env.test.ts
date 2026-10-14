import { describe, it, expect } from "vitest";
import { headlessBrowserEnv } from "./browser-env";

describe("headlessBrowserEnv", () => {
  it("drops the desktop display variables and keeps everything else", () => {
    const env = { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", PATH: "/bin", HOME: "/h" };
    expect(headlessBrowserEnv(env)).toEqual({ PATH: "/bin", HOME: "/h" });
  });
  it("does not modify the input", () => {
    const env = { DISPLAY: ":0" };
    headlessBrowserEnv(env);
    expect(env).toEqual({ DISPLAY: ":0" });
  });
  it("omits undefined values", () => {
    expect(headlessBrowserEnv({ A: undefined, B: "1" })).toEqual({ B: "1" });
  });
});
