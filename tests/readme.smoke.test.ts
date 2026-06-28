import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("README documents auth-walled live capture", () => {
  const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

  it("documents the target: live mode and the login workflow", () => {
    expect(readme).toMatch(/target:\s*`?live/i);
    expect(readme).toMatch(/demo-video login/);
  });

  it("documents the auth-at-rest safety (profile outside the repo)", () => {
    expect(readme).toMatch(/\.cache\/agent-demo-video|outside the repo|at rest/i);
  });
});
