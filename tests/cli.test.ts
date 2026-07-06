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
    expect(parseCommand(["--render-host=hermes-01", "cfg.json"])).toEqual({
      cmd: "run",
      cfgPath: "cfg.json",
      renderHost: "hermes-01",
    });
  });
  it("still parses the login verb (render host irrelevant)", () => {
    expect(parseCommand(["login", "cfg.json"])).toEqual({ cmd: "login", cfgPath: "cfg.json", renderHost: undefined });
  });
});
