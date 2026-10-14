import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** specs/motion-cards-spec.md S5: motion cards need the optional hyperframes package and Node 22+. */
export const MIN_NODE_MAJOR = 22;
/** The one HyperFrames version motion cards are built and tested against; any other is rejected. */
export const HYPERFRAMES_VERSION = "0.8.155";
const INSTALL_HINT = `install it next to agent-demo-video: npm install hyperframes@${HYPERFRAMES_VERSION}`;

export type MotionRequirements =
  | { ok: true; hyperframesBin: string; version: string }
  | { ok: false; problems: string[] };

interface Probes {
  resolvePackageJson: () => string;
  readVersion: (packageJsonPath: string) => string;
  nodeVersion: string;
}

const defaultProbes = (): Probes => {
  const require = createRequire(import.meta.url);
  return {
    resolvePackageJson: () => require.resolve("hyperframes/package.json"),
    readVersion: (p) => JSON.parse(readFileSync(p, "utf8")).version,
    nodeVersion: process.version,
  };
};

export function checkMotionRequirements(probes: Probes = defaultProbes()): MotionRequirements {
  const problems: string[] = [];
  const major = Number(probes.nodeVersion.replace(/^v/, "").split(".")[0]);
  if (!(major >= MIN_NODE_MAJOR)) problems.push(`brand.motion needs Node ${MIN_NODE_MAJOR} or newer (running ${probes.nodeVersion})`);
  let pkg: string | undefined;
  try { pkg = probes.resolvePackageJson(); } catch {
    problems.push(`brand.motion needs the optional "hyperframes" package: hyperframes is not installed; ${INSTALL_HINT}`);
  }
  let version: string | undefined;
  if (pkg) {
    try { version = String(probes.readVersion(pkg)); } catch { version = "an unreadable version"; }
    if (version !== HYPERFRAMES_VERSION) problems.push(`brand.motion needs hyperframes ${HYPERFRAMES_VERSION} (found ${version}); ${INSTALL_HINT}`);
  }
  if (problems.length || !pkg || version === undefined) return { ok: false, problems };
  return { ok: true, hyperframesBin: join(dirname(pkg), "bin", "hyperframes.mjs"), version };
}
