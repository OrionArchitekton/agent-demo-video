import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// vitest runs with cwd = repo root (see the other smoke tests).
const repoRoot = process.cwd();

describe("auth-at-rest: secrets must never reach a tracked git path", () => {
  it(".gitignore excludes persisted-auth profile / storageState artifacts", () => {
    const gi = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
    for (const pat of [".auth/", "*.playwright-profile", "storageState", "userDataDir"]) {
      expect(gi, `.gitignore must exclude ${pat}`).toContain(pat);
    }
  });

  it("no tracked PATH is a chromium persistent-profile artifact", () => {
    // The real leak vector is a launchPersistentContext profile: Default/Cookies,
    // Login Data, Web Data (SQLite BINARIES — extensionless, so a content grep misses
    // them), plus leveldb stores. Catch them by tracked PATH, not content.
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const artifactPath =
      /(^|\/)(Cookies|Login Data|Web Data|Local State)(-journal)?$|\.playwright-profile(\/|$)|(^|\/)(IndexedDB|Local Storage|Service Worker|Sessions)\/|leveldb(\/|$)|(^|\/)Default\/|(^|\/)storageState[^/]*\.json$/i;
    const offenders = tracked.filter((f) => artifactPath.test(f));
    expect(offenders, `chromium profile artifacts tracked: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no tracked file contains a chromium auth profile artifact or session token", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    // Shapes that only appear if a persisted authed profile / storageState leaked into the tree.
    // (Prefixes/filenames only — deliberately NOT full secrets, so this guard file itself
    //  cannot trip the gitleaks ruleset.)
    const authArtifact =
      /\bCookies\b|Login Data|cookies\.sqlite|Local Storage\/leveldb|"cookies"\s*:\s*\[\s*{[^}]*httpOnly|xoxb-[A-Za-z0-9-]{6}|xoxp-[A-Za-z0-9-]{6}|sk_live_[A-Za-z0-9]{6}/;
    const offenders: string[] = [];
    for (const f of tracked) {
      if (/\.(png|jpe?g|gif|webm|mp4|mp3|ico|woff2?)$|(^|\/)pnpm-lock\.yaml$/.test(f)) continue;
      if (f === "tests/security.test.ts") continue; // this gate names the patterns
      let body = "";
      try {
        body = readFileSync(resolve(repoRoot, f), "utf8");
      } catch {
        continue;
      }
      if (authArtifact.test(body)) offenders.push(f);
    }
    expect(offenders, `auth artifacts found in tracked files: ${offenders.join(", ")}`).toEqual([]);
  });
});
