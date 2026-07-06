import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/cli";

describe("parseCommand --render-host", () => {
  it("parses a bare config path with no render host", () => {
    expect(parseCommand(["demo.config.json"])).toEqual({ cmd: "run", cfgPath: "demo.config.json", renderHost: undefined });
  });
  it("parses `--render-host <host>` and keeps the config positional", () => {
    expect(parseCommand(["demo.config.json", "--render-host", "user@host"])).toEqual({
      cmd: "run",
      cfgPath: "demo.config.json",
      renderHost: "user@host",
    });
  });
  it("parses the `--render-host=<host>` form and flag-before-config order", () => {
    expect(parseCommand(["--render-host=build-host", "cfg.json"])).toEqual({
      cmd: "run",
      cfgPath: "cfg.json",
      renderHost: "build-host",
    });
  });
  it("still parses the login verb (render host irrelevant)", () => {
    expect(parseCommand(["login", "cfg.json"])).toEqual({ cmd: "login", cfgPath: "cfg.json", renderHost: undefined });
  });
  it("fails loudly on a missing or option-like --render-host value (no fallback, no ssh option injection)", () => {
    expect(() => parseCommand(["cfg.json", "--render-host"])).toThrow(/render-host/);
    expect(() => parseCommand(["cfg.json", "--render-host="])).toThrow(/render-host/);
    expect(() => parseCommand(["cfg.json", "--render-host=-oProxyCommand=x"])).toThrow(/render-host/);
    expect(() => parseCommand(["cfg.json", "--render-host", "-oProxyCommand=x"])).toThrow(/render-host/);
  });
});
