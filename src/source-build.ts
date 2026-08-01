import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizedGitEnvironment } from "./git-environment";

export const SOURCE_BUILD_SCOPED_PATHS = [
  "src",
  "scripts/remote-entry.ts",
  "scripts/run-source-attested-render.sh",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
] as const;

export type SourceBuildAttestation = {
  version: 2;
  executionMode: "detached-commit-snapshot";
  commit: string;
  runner: "src/cli.ts";
  scopedPaths: [...typeof SOURCE_BUILD_SCOPED_PATHS];
  treeSha256: string;
  packageJsonSha256: string;
  pnpmLockSha256: string;
};

declare const sourceBuildSessionBrand: unique symbol;

export type SourceBuildSession = {
  readonly [sourceBuildSessionBrand]: true;
  attestation: SourceBuildAttestation;
  repoRoot: string;
  runnerPath: string;
};

const issuedSourceBuildSessions = new WeakSet<object>();

function runGit(repoRoot: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/git",
      [
        "--no-replace-objects",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      {
        cwd: repoRoot,
        encoding: "buffer",
        env: sanitizedGitEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const detail = stderr.toString("utf8").trim() || error.message;
        reject(new Error(`[agent-demo-video] git ${args[0] ?? "command"} failed: ${detail}`, { cause: error }));
      },
    );
  });
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function resolveCommit(repoRoot: string, commit: string): Promise<string> {
  return (await runGit(repoRoot, ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`]))
    .toString("utf8")
    .trim();
}

async function commitFile(repoRoot: string, commit: string, path: string): Promise<Buffer> {
  return runGit(repoRoot, ["show", `${commit}:${path}`]);
}

/**
 * Recompute the source-build claim from committed Git objects only.
 *
 * This is intentionally independent of the current checkout, so Factory or
 * another verifier can validate an attestation for any locally available
 * commit without checking it out.
 */
export async function computeSourceBuildAttestation(
  repoRoot: string,
  commit = "HEAD",
): Promise<SourceBuildAttestation> {
  const root = await realpath(repoRoot);
  const resolvedCommit = await resolveCommit(root, commit);
  await runGit(root, ["cat-file", "-e", `${resolvedCommit}:src/cli.ts`]);
  const scopedTree = await runGit(root, [
    "ls-tree",
    "-r",
    "-z",
    resolvedCommit,
    "--",
    ...SOURCE_BUILD_SCOPED_PATHS,
  ]);
  const treeHash = createHash("sha256")
    .update(resolvedCommit)
    .update("\0")
    .update(scopedTree)
    .digest("hex");
  const [packageJson, pnpmLock] = await Promise.all([
    commitFile(root, resolvedCommit, "package.json"),
    commitFile(root, resolvedCommit, "pnpm-lock.yaml"),
  ]);
  return {
    version: 2,
    executionMode: "detached-commit-snapshot",
    commit: resolvedCommit,
    runner: "src/cli.ts",
    scopedPaths: [...SOURCE_BUILD_SCOPED_PATHS],
    treeSha256: treeHash,
    packageJsonSha256: sha256(packageJson),
    pnpmLockSha256: sha256(pnpmLock),
  };
}

function attestationsEqual(
  actual: SourceBuildAttestation,
  expected: SourceBuildAttestation,
): boolean {
  return (
    actual.version === expected.version &&
    actual.executionMode === expected.executionMode &&
    actual.commit === expected.commit &&
    actual.runner === expected.runner &&
    actual.treeSha256 === expected.treeSha256 &&
    actual.packageJsonSha256 === expected.packageJsonSha256 &&
    actual.pnpmLockSha256 === expected.pnpmLockSha256 &&
    actual.scopedPaths.length === expected.scopedPaths.length &&
    actual.scopedPaths.every((path, index) => path === expected.scopedPaths[index])
  );
}

/** Recompute and compare every attested field for the attestation's commit. */
export async function validateSourceBuildAttestation(
  repoRoot: string,
  attestation: SourceBuildAttestation,
): Promise<SourceBuildAttestation> {
  const expected = await computeSourceBuildAttestation(repoRoot, attestation.commit);
  if (!attestationsEqual(attestation, expected)) {
    throw new Error(
      `[agent-demo-video] source-build attestation does not match commit ${attestation.commit}`,
    );
  }
  return expected;
}

async function assertActualRunner(repoRoot: string, runnerPath: string): Promise<string> {
  const actualRunner = await realpath(runnerPath);
  const expectedRunner = await realpath(join(repoRoot, "src/cli.ts"));
  if (actualRunner !== expectedRunner) {
    throw new Error(
      `[agent-demo-video] --attest-source-build must run the actual tracked src/cli.ts runner; got ` +
        relative(repoRoot, actualRunner).split(sep).join("/"),
    );
  }
  await runGit(repoRoot, ["ls-files", "--error-unmatch", "--", "src/cli.ts"]);
  return actualRunner;
}

type GitTreeEntry = {
  mode: string;
  object: string;
  path: string;
};

function parseTreeEntries(bytes: Buffer): GitTreeEntry[] {
  return bytes
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const header = entry.slice(0, tab).split(" ");
      const path = entry.slice(tab + 1);
      if (tab < 0 || header.length !== 3 || !header[0] || !header[2] || !path) {
        throw new Error(`[agent-demo-video] could not parse scoped Git tree entry: ${entry}`);
      }
      return { mode: header[0], object: header[2], path };
    });
}

async function collectScopedFiles(
  repoRoot: string,
  requireReadOnly = false,
): Promise<string[]> {
  const files: string[] = [];
  const visit = async (relativePath: string): Promise<void> => {
    const absolute = join(repoRoot, relativePath);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`[agent-demo-video] scoped source path may not be a symlink: ${relativePath}`);
    }
    if (requireReadOnly && (stat.mode & 0o222) !== 0) {
      throw new Error(
        `[agent-demo-video] committed source snapshot path must be non-writable: ${relativePath}`,
      );
    }
    if (stat.isDirectory()) {
      const names = await readdir(absolute);
      for (const name of names.sort()) {
        await visit(join(relativePath, name));
      }
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`[agent-demo-video] scoped source path must be a regular file: ${relativePath}`);
    }
    files.push(relativePath.split(sep).join("/"));
  };
  for (const path of SOURCE_BUILD_SCOPED_PATHS) {
    await visit(path);
  }
  return files.sort();
}

async function assertScopedPathsClean(
  repoRoot: string,
  commit: string,
  requireReadOnly = false,
): Promise<void> {
  const treeEntries = parseTreeEntries(await runGit(repoRoot, [
    "ls-tree",
    "-r",
    "-z",
    commit,
    "--",
    ...SOURCE_BUILD_SCOPED_PATHS,
  ]));
  const treeByPath = new Map(treeEntries.map((entry) => [entry.path, entry]));
  const actualPaths = await collectScopedFiles(repoRoot, requireReadOnly);
  const expectedPaths = [...treeByPath.keys()].sort();
  if (
    actualPaths.length !== expectedPaths.length ||
    actualPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    const actual = new Set(actualPaths);
    const expected = new Set(expectedPaths);
    const added = actualPaths.filter((path) => !expected.has(path));
    const missing = expectedPaths.filter((path) => !actual.has(path));
    throw new Error(
      `[agent-demo-video] scoped source paths are dirty; extra=[${added.join(", ")}], ` +
      `missing=[${missing.join(", ")}]`,
    );
  }

  const indexEntries = (await runGit(repoRoot, [
    "ls-files",
    "--stage",
    "-z",
    "--",
    ...SOURCE_BUILD_SCOPED_PATHS,
  ]))
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const indexByPath = new Map<string, { mode: string; object: string; stage: string }>();
  for (const entry of indexEntries) {
    const tab = entry.indexOf("\t");
    const [mode, object, stage] = entry.slice(0, tab).split(" ");
    const path = entry.slice(tab + 1);
    if (tab < 0 || !mode || !object || !stage || !path || indexByPath.has(path)) {
      throw new Error(`[agent-demo-video] scoped Git index entry is invalid: ${entry}`);
    }
    indexByPath.set(path, { mode, object, stage });
  }

  const flags = (await runGit(repoRoot, [
    "ls-files",
    "-v",
    "-z",
    "--",
    ...SOURCE_BUILD_SCOPED_PATHS,
  ]))
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const flagByPath = new Map(flags.map((entry) => [entry.slice(2), entry.slice(0, 1)]));

  for (const path of expectedPaths) {
    const expected = treeByPath.get(path)!;
    const indexed = indexByPath.get(path);
    if (
      expected.mode !== "100644" &&
      expected.mode !== "100755"
    ) {
      throw new Error(`[agent-demo-video] unsupported scoped Git object mode ${expected.mode}: ${path}`);
    }
    if (
      !indexed ||
      indexed.stage !== "0" ||
      indexed.mode !== expected.mode ||
      indexed.object !== expected.object
    ) {
      throw new Error(`[agent-demo-video] scoped Git index differs from commit ${commit}: ${path}`);
    }
    if (flagByPath.get(path) !== "H") {
      throw new Error(
        `[agent-demo-video] scoped Git index uses assume-unchanged, skip-worktree, or another ` +
        `nonstandard flag: ${path}`,
      );
    }
    const absolute = join(repoRoot, path);
    const stat = await lstat(absolute);
    const expectedExecutable = expected.mode === "100755";
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      ((stat.mode & 0o111) !== 0) !== expectedExecutable
    ) {
      throw new Error(`[agent-demo-video] scoped working-tree type or mode differs from commit: ${path}`);
    }
    const [workingBytes, committedBytes] = await Promise.all([
      readFile(absolute),
      runGit(repoRoot, ["cat-file", "blob", expected.object]),
    ]);
    if (!workingBytes.equals(committedBytes)) {
      throw new Error(`[agent-demo-video] scoped working-tree bytes differ from commit ${commit}: ${path}`);
    }
  }
}

/**
 * Admit the current source runner and bind it to a clean, committed source
 * tree. Ordinary CLI runs never call this function.
 */
export async function attestSourceBuild(runnerPath: string): Promise<SourceBuildSession> {
  const launchRoot = process.env.AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_ROOT;
  const authorityRoot = process.env.AGENT_DEMO_VIDEO_SOURCE_AUTHORITY_REPO;
  const launchCommit = process.env.AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_COMMIT;
  if (!launchRoot || !authorityRoot || !launchCommit) {
    throw new Error(
      `[agent-demo-video] --attest-source-build requires the committed source snapshot launcher`,
    );
  }

  const repoRoot = (
    await runGit(dirname(runnerPath), ["rev-parse", "--show-toplevel"])
  ).toString("utf8").trim();
  const root = await realpath(repoRoot);
  const expectedRoot = await realpath(launchRoot);
  if (root !== expectedRoot) {
    throw new Error(
      `[agent-demo-video] source snapshot runner root does not match the launcher-owned root`,
    );
  }

  const privateParent = await lstat(dirname(root));
  if (
    privateParent.isSymbolicLink() ||
    !privateParent.isDirectory() ||
    (privateParent.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && privateParent.uid !== process.getuid())
  ) {
    throw new Error(
      `[agent-demo-video] source snapshot parent must be a private launcher-owned 0700 directory`,
    );
  }

  const authority = await realpath(authorityRoot);
  const discoveredAuthority = (
    await runGit(authority, ["rev-parse", "--show-toplevel"])
  ).toString("utf8").trim();
  if (await realpath(discoveredAuthority) !== authority) {
    throw new Error(
      `[agent-demo-video] source snapshot authority must name the repository root`,
    );
  }
  const resolvedLaunchCommit = await resolveCommit(authority, launchCommit);
  if (resolvedLaunchCommit !== launchCommit) {
    throw new Error(
      `[agent-demo-video] source snapshot launcher must pin one full commit SHA`,
    );
  }
  const snapshotHead = await resolveCommit(root, "HEAD");
  if (snapshotHead !== resolvedLaunchCommit) {
    throw new Error(
      `[agent-demo-video] source snapshot HEAD does not match the launcher commit`,
    );
  }
  const snapshotBranch = (
    await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"])
  ).toString("utf8").trim();
  if (snapshotBranch !== "HEAD") {
    throw new Error(
      `[agent-demo-video] source snapshot must be a detached Git worktree`,
    );
  }
  const [authorityCommon, snapshotCommon] = await Promise.all([
    runGit(authority, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
    runGit(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  ]);
  if (
    await realpath(authorityCommon.toString("utf8").trim()) !==
    await realpath(snapshotCommon.toString("utf8").trim())
  ) {
    throw new Error(
      `[agent-demo-video] source snapshot is not owned by the authority repository`,
    );
  }

  const actualRunner = await assertActualRunner(root, runnerPath);
  const attestation = await computeSourceBuildAttestation(
    root,
    resolvedLaunchCommit,
  );
  await assertScopedPathsClean(root, attestation.commit, true);
  const session = {
    attestation,
    repoRoot: root,
    runnerPath: actualRunner,
  } as SourceBuildSession;
  issuedSourceBuildSessions.add(session);
  return session;
}

function assertIssuedSourceBuildSession(session: SourceBuildSession): void {
  if (!issuedSourceBuildSessions.has(session)) {
    throw new Error(
      `[agent-demo-video] source-build session was not issued by this committed snapshot module`,
    );
  }
}

/**
 * Bind the admitted capability to the exact pipeline and source-admission
 * modules executing inside the same detached snapshot module graph.
 */
export async function assertSourceBuildExecutionContext(
  session: SourceBuildSession,
  pipelineModulePath: string,
): Promise<void> {
  assertIssuedSourceBuildSession(session);
  const [
    actualPipeline,
    expectedPipeline,
    actualSourceBuild,
    expectedSourceBuild,
  ] = await Promise.all([
    realpath(pipelineModulePath),
    realpath(join(session.repoRoot, "src/pipeline.ts")),
    realpath(fileURLToPath(import.meta.url)),
    realpath(join(session.repoRoot, "src/source-build.ts")),
  ]);
  if (
    actualPipeline !== expectedPipeline ||
    actualSourceBuild !== expectedSourceBuild
  ) {
    throw new Error(
      `[agent-demo-video] source-build capability cannot cross snapshot module graphs`,
    );
  }
}

/** Blocking post-render drift check for a source-attested run. */
export async function assertSourceBuildUnchanged(session: SourceBuildSession): Promise<void> {
  try {
    assertIssuedSourceBuildSession(session);
    await assertActualRunner(session.repoRoot, session.runnerPath);
    await assertScopedPathsClean(
      session.repoRoot,
      session.attestation.commit,
      true,
    );
    const current = await computeSourceBuildAttestation(session.repoRoot, "HEAD");
    if (!attestationsEqual(current, session.attestation)) {
      throw new Error(`HEAD no longer matches attested commit ${session.attestation.commit}`);
    }
  } catch (error) {
    throw new Error(
      `[agent-demo-video] source changed during render; the completed artifact is not source-attested: ` +
        `${(error as Error).message}`,
      { cause: error },
    );
  }
}
