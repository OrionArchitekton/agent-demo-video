import { describe, it, expect } from "vitest";
import { parseCommand } from "./cli";

describe("parseCommand (CLI dispatch)", () => {
  it("routes `login <cfg>` to the login subcommand", () => {
    expect(parseCommand(["login", "my.json"])).toEqual({ cmd: "login", cfgPath: "my.json" });
  });
  it("treats a bare config path as the pipeline run (back-compat)", () => {
    expect(parseCommand(["demo.config.json"])).toEqual({ cmd: "run", cfgPath: "demo.config.json" });
  });
  // A per-run decline of the fail-closed selector gate. The config key is the
  // durable declaration; this flag is the one-off override an operator reaches
  // for, and it must not swallow the config path positional.
  it("accepts --no-preflight as a per-run decline of the selector gate", () => {
    expect(parseCommand(["my.json", "--no-preflight"])).toEqual({ cmd: "run", cfgPath: "my.json", preflight: false });
  });
  it("defaults to demo.config.json when no path is given", () => {
    expect(parseCommand([])).toEqual({ cmd: "run", cfgPath: "demo.config.json" });
    expect(parseCommand(["login"])).toEqual({ cmd: "login", cfgPath: "demo.config.json" });
  });
});
