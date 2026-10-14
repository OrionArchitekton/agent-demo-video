import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import { parseScript } from "../src/parse-script";
import { resolveSelectorFindings, structuralFindings } from "../src/preflight";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("self-demo preflight", () => {
  it("every shot passes the selector gate offline with no blocking finding", async () => {
    const cfg = loadConfig("demos/self/demo.config.json");
    const manifest = parseScript(read(cfg.script));
    const structural = structuralFindings(manifest, cfg).filter((f) => f.severity === "blocking");
    expect(structural, JSON.stringify(structural)).toEqual([]);
    const selectors = (await resolveSelectorFindings(manifest, cfg)).filter((f) => f.severity === "blocking");
    expect(selectors, JSON.stringify(selectors)).toEqual([]);
    expect(manifest.shots.length).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
