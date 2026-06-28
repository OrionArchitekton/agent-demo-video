import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

/** The cache root for auth profiles, always ABSOLUTE. A relative/empty
 *  `XDG_CACHE_HOME` is ignored (the XDG spec requires absolute) so the profile
 *  can never land under the current working tree. */
function cacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".cache");
  return join(base, "agent-demo-video");
}

/** A filesystem-safe slug for the login URL, so each workspace/app gets its OWN default
 *  profile (no cross-tenant cookie/localStorage contamination). A readable host prefix
 *  plus a short hash of the FULL url, so two workspaces/tenants/staging-vs-prod on the
 *  SAME host (e.g. app.slack.com/<workspace>) still resolve to distinct profiles. */
function hostSlug(loginUrl?: string): string {
  if (!loginUrl) return "default";
  try {
    const host = (new URL(loginUrl).host || "app").replace(/[^a-zA-Z0-9._-]/g, "_");
    const hash = createHash("sha256").update(loginUrl).digest("hex").slice(0, 8);
    return `${host}-${hash}`;
  } catch {
    return "default";
  }
}

/** Nearest ancestor (from cwd) containing a `.git` entry — the git working tree
 *  root, if any. (`.git` is a dir in a normal clone, a FILE in a worktree.) */
function gitWorkingTreeRoot(): string | null {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the directory for the persisted authenticated browser profile.
 *
 * The profile holds live session cookies/tokens AT REST, so it MUST live outside
 * the tracked repo. Resolution:
 *  - unset            → `<cacheRoot>/<loginUrl-host>` (per-workspace isolation);
 *  - absolute path    → used as-is (the operator's explicit out-of-repo choice);
 *  - relative path    → a NAMED profile UNDER the cache root (never cwd/repo).
 *
 * Hard invariant: the resolved path is ALWAYS absolute and is REJECTED if it
 * falls inside the git working tree — so an absolute in-repo path, a relative
 * `XDG_CACHE_HOME`, or a traversing relative value cannot drop secrets into the tree.
 */
export function resolveProfileDir(profileDir?: string, loginUrl?: string): string {
  const root = cacheRoot();
  let resolved: string;

  if (!profileDir || profileDir.length === 0) {
    resolved = join(root, hostSlug(loginUrl));
  } else if (isAbsolute(profileDir)) {
    resolved = profileDir;
  } else {
    const candidate = resolve(root, profileDir);
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      throw new Error(`resolveProfileDir: profileDir "${profileDir}" escapes the profile root ${root}`);
    }
    resolved = candidate;
  }

  const treeRoot = gitWorkingTreeRoot();
  if (treeRoot && (resolved === treeRoot || resolved.startsWith(treeRoot + sep))) {
    throw new Error(
      `resolveProfileDir: profile path ${resolved} is inside the git working tree ${treeRoot} — ` +
        `auth profiles (session tokens at rest) must live outside the repo (unset profileDir, or use an absolute path under ~/.cache).`,
    );
  }
  return resolved;
}
