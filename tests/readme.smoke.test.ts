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

describe("README documents the command voice aligner for an npm install", () => {
  const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("## Use your own voice"), readme.indexOf("## Third-party tabs"));

  it("shows the aligner by absolute paths, not a checkout-relative script", () => {
    expect(section).not.toMatch(/"tools\/align_whisper\.py"/);
    expect(section).toContain('"/path/to/venv/bin/python", "/path/to/agent-demo-video/tools/align_whisper.py"');
  });

  it("says where a global install puts the script and how to get faster-whisper", () => {
    expect(section).toContain("$(npm root -g)/agent-demo-video/tools/align_whisper.py");
    expect(section).toContain("python3 -m venv .venv && .venv/bin/pip install faster-whisper");
  });

  it("says command-written timings win and the aligner is then not run", () => {
    expect(section).toMatch(/they win and the aligner is not\s+run/);
  });
});
