import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("docs document auth-walled live capture", () => {
  const guide = page("docs/guide/authenticated-capture.md");

  it("documents the target: live mode and the login workflow", () => {
    expect(guide).toMatch(/target:\s*`?live/i);
    expect(guide).toMatch(/demo-video login/);
  });

  it("documents the auth-at-rest safety (profile outside the repo)", () => {
    expect(guide).toMatch(/\.cache\/agent-demo-video|outside the repo|at rest/i);
  });
});

describe("docs document the command voice aligner for an npm install", () => {
  const section = page("docs/guide/voice.md");

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
