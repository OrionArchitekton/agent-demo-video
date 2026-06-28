import { describe, it, expect } from "vitest";
import { isAbsolute, join } from "node:path";
import { resolveProfileDir } from "./profile";

describe("resolveProfileDir", () => {
  it("defaults to an absolute ~/.cache/agent-demo-video when unset (outside any repo)", () => {
    const p = resolveProfileDir();
    expect(isAbsolute(p)).toBe(true);
    expect(p).toContain("agent-demo-video");
  });
  it("honors XDG_CACHE_HOME for the default base", () => {
    const prev = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = "/tmp/xdg-adv-test";
    try {
      expect(resolveProfileDir()).toBe(join("/tmp/xdg-adv-test", "agent-demo-video"));
    } finally {
      if (prev === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prev;
    }
  });
  it("treats a relative profileDir as a NAMED profile UNDER the cache root (never cwd/repo)", () => {
    const p = resolveProfileDir("slack");
    expect(isAbsolute(p)).toBe(true);
    expect(p).toContain(join("agent-demo-video", "slack"));
  });
  it("rejects a relative profileDir that traverses out of the profile root", () => {
    expect(() => resolveProfileDir("../../escape")).toThrow(/escape/i);
  });
  it("returns an already-absolute profileDir unchanged", () => {
    expect(resolveProfileDir("/abs/profile")).toBe("/abs/profile");
  });
});
