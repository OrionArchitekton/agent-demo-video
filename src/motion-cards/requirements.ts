import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** specs/motion-cards-spec.md S5: motion cards need the optional hyperframes package and Node 22.12+. */
export const MIN_NODE_MAJOR = 22;
export const MIN_NODE_MINOR = 12;
/** The one HyperFrames version motion cards are built and tested against; any other is rejected. */
export const HYPERFRAMES_VERSION = "0.8.155";
const INSTALL_HINT = `install it next to agent-demo-video: npm install hyperframes@${HYPERFRAMES_VERSION}`;

export type MotionRequirements =
  | { ok: true; hyperframesBin: string; version: string }
  | { ok: false; problems: string[] };

interface Probes {
  resolvePackageJson: () => string;
  readPackageJson: (packageJsonPath: string) => { version: string; repository?: unknown };
  fileExists: (path: string) => boolean;
  nodeVersion: string;
}

const defaultProbes = (): Probes => {
  const require = createRequire(import.meta.url);
  return {
    resolvePackageJson: () => require.resolve("hyperframes/package.json"),
    readPackageJson: (p) => JSON.parse(readFileSync(p, "utf8")),
    fileExists: existsSync,
    nodeVersion: process.version,
  };
};

export function checkMotionRequirements(probes: Probes = defaultProbes()): MotionRequirements {
  const problems: string[] = [];
  const [major, minor] = probes.nodeVersion.replace(/^v/, "").split(".").map(Number) as [number, number];
  const nodeOk = major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
  if (!nodeOk) problems.push(`brand.motion needs Node ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} or newer (running ${probes.nodeVersion})`);
  let pkg: string | undefined;
  try { pkg = probes.resolvePackageJson(); } catch {
    problems.push(`brand.motion needs the optional "hyperframes" package: hyperframes is not installed; ${INSTALL_HINT}`);
  }
  let version: string | undefined;
  if (pkg) {
    let repoUrl = "";
    try {
      const json = probes.readPackageJson(pkg);
      version = String(json.version);
      const repo = json.repository;
      repoUrl = typeof repo === "string" ? repo : repo && typeof (repo as { url?: unknown }).url === "string" ? (repo as { url: string }).url : "";
    } catch { version = "an unreadable version"; }
    if (!repoUrl.includes("heygen-com/hyperframes") || !probes.fileExists(join(dirname(pkg), "bin", "hyperframes.mjs"))) {
      problems.push('the installed "hyperframes" package is not the official HeyGen package or is incomplete');
    }
    if (version !== HYPERFRAMES_VERSION) problems.push(`brand.motion needs hyperframes ${HYPERFRAMES_VERSION} (found ${version}); ${INSTALL_HINT}`);
  }
  if (problems.length || !pkg || version === undefined) return { ok: false, problems };
  return { ok: true, hyperframesBin: join(dirname(pkg), "bin", "hyperframes.mjs"), version };
}
