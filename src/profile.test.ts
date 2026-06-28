import { describe, it, expect } from "vitest";
import { isAbsolute, join } from "node:path";
import { resolveProfileDir } from "./profile";

function withEnv(key: string, val: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
  try { fn(); } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

describe("resolveProfileDir", () => {
  it("defaults to an absolute per-host profile under the cache root", () => {
    const p = resolveProfileDir(undefined, "https://app.slack.com/client");
    expect(isAbsolute(p)).toBe(true);
    expect(p).toContain("agent-demo-video");
    expect(p).toContain("app.slack.com"); // namespaced by login host — no cross-workspace bleed
  });
  it("uses a 'default' namespace when no loginUrl is given", () => {
    expect(resolveProfileDir()).toContain(join("agent-demo-video", "default"));
  });
  it("honors an ABSOLUTE XDG_CACHE_HOME for the default base", () => {
    withEnv("XDG_CACHE_HOME", "/tmp/xdg-adv-test", () => {
      expect(resolveProfileDir()).toBe(join("/tmp/xdg-adv-test", "agent-demo-video", "default"));
    });
  });
  it("IGNORES a relative XDG_CACHE_HOME (never resolves the profile under cwd)", () => {
    withEnv("XDG_CACHE_HOME", ".cache", () => {
      const p = resolveProfileDir();
      expect(isAbsolute(p)).toBe(true);
      expect(p.startsWith(process.cwd())).toBe(false);
    });
  });
  it("treats a relative profileDir as a NAMED profile UNDER the cache root", () => {
    const p = resolveProfileDir("slack");
    expect(isAbsolute(p)).toBe(true);
    expect(p).toContain(join("agent-demo-video", "slack"));
  });
  it("rejects a relative profileDir that traverses out of the profile root", () => {
    expect(() => resolveProfileDir("../../escape")).toThrow(/escape/i);
  });
  it("rejects an absolute profileDir inside the git working tree (auth-at-rest leak)", () => {
    expect(() => resolveProfileDir(join(process.cwd(), "auth-here"))).toThrow(/inside the git working tree/i);
  });
  it("returns an absolute outside-the-repo profileDir unchanged", () => {
    expect(resolveProfileDir("/abs/profile")).toBe("/abs/profile");
  });
});
