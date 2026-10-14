import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// vitest runs with cwd = repo root (see the other smoke tests).
const root = process.cwd();
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");
const json = (p: string): any => JSON.parse(read(p));
const pkg = json("package.json") as { name: string; version: string };

describe("plugin and marketplace manifests", () => {
  const plugin = json(".claude-plugin/plugin.json");
  const market = json(".claude-plugin/marketplace.json");

  it("names the plugin after the package and carries the package version", () => {
    expect(plugin.name).toBe(pkg.name);
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.license).toBe("MIT");
    expect(plugin.repository).toBe("https://github.com/OrionArchitekton/agent-demo-video");
  });

  it("makes the repository a marketplace with exactly this plugin at its root", () => {
    expect(market.name).toBe(pkg.name);
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0].name).toBe(plugin.name);
    expect(market.plugins[0].source).toBe("./");
    expect(market.plugins[0].version).toBe(pkg.version);
  });
});
