import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

/**
 * Resolve the directory for the persisted authenticated browser profile.
 *
 * The profile holds live session cookies/tokens AT REST, so it MUST live outside
 * the tracked repo. Resolution:
 *  - unset            → `$XDG_CACHE_HOME/agent-demo-video` (or `~/.cache/agent-demo-video`);
 *  - absolute path    → used as-is (the operator's explicit out-of-repo choice);
 *  - relative path    → a NAMED profile UNDER the cache root (never cwd/repo-relative,
 *                       which would otherwise drop secrets into the working tree).
 *
 * A relative value that would traverse out of the cache root is rejected.
 */
export function resolveProfileDir(profileDir?: string): string {
  const cacheBase =
    process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.length > 0
      ? process.env.XDG_CACHE_HOME
      : join(homedir(), ".cache");
  const root = join(cacheBase, "agent-demo-video");

  if (!profileDir || profileDir.length === 0) return root;
  if (isAbsolute(profileDir)) return profileDir;

  const candidate = resolve(root, profileDir);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(`resolveProfileDir: profileDir "${profileDir}" escapes the profile root ${root}`);
  }
  return candidate;
}
