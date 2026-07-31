import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  assertSourceBuildUnchanged,
  attestSourceBuild,
  computeSourceBuildAttestation,
  type SourceBuildSession,
  validateSourceBuildAttestation,
} from "./source-build";

const exec = promisify(execFile);

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: repo });
  return stdout.trim();
}

type SourceFixture = {
  authorityRoot: string;
  root: string;
  runner: string;
  commit: string;
};

async function freezeFixture(root: string): Promise<void> {
  await exec("chmod", ["-R", "a-w", join(root, "src")]);
  await exec("chmod", [
    "a-w",
    root,
    join(root, "scripts"),
    join(root, "scripts/remote-entry.ts"),
    join(root, "scripts/run-source-attested-render.sh"),
    join(root, "package.json"),
    join(root, "pnpm-lock.yaml"),
    join(root, "tsconfig.json"),
  ]);
}

async function fixtureRepo(): Promise<SourceFixture> {
  const authorityRoot = await mkdtemp(join(tmpdir(), "source-build-authority-"));
  await mkdir(join(authorityRoot, "src"));
  await mkdir(join(authorityRoot, "scripts"));
  const files: Record<string, string> = {
    "src/cli.ts": "export const runner = true;\n",
    "src/helper.ts": "export const helper = true;\n",
    "scripts/remote-entry.ts": "export const remote = true;\n",
    "scripts/run-source-attested-render.sh": "#!/usr/bin/env bash\n",
    "package.json": '{"name":"fixture"}\n',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "tsconfig.json": '{"compilerOptions":{}}\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(authorityRoot, path), content);
  }
  await chmod(join(authorityRoot, "scripts/run-source-attested-render.sh"), 0o755);
  await git(authorityRoot, "init");
  await git(authorityRoot, "config", "user.email", "source-build@example.test");
  await git(authorityRoot, "config", "user.name", "Source Build Test");
  await git(authorityRoot, "add", ".");
  await git(authorityRoot, "commit", "-m", "fixture");
  const commit = await git(authorityRoot, "rev-parse", "HEAD");
  const snapshotParent = await mkdtemp(join(tmpdir(), "source-build-snapshot-"));
  await chmod(snapshotParent, 0o700);
  const root = join(snapshotParent, "source");
  await git(authorityRoot, "worktree", "add", "--detach", root, commit);
  await freezeFixture(root);
  return {
    authorityRoot,
    root,
    runner: join(root, "src/cli.ts"),
    commit,
  };
}

async function withSnapshotLaunch<T>(
  fixture: SourceFixture,
  operation: () => Promise<T>,
): Promise<T> {
  const names = {
    AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_ROOT: fixture.root,
    AGENT_DEMO_VIDEO_SOURCE_AUTHORITY_REPO: fixture.authorityRoot,
    AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_COMMIT: fixture.commit,
  };
  const previous = Object.fromEntries(
    Object.keys(names).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, names);
  try {
    return await operation();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

describe("source-build attestation", () => {
  it("refuses a source attestation outside the committed snapshot launcher", async () => {
    const { runner } = await fixtureRepo();
    await expect(attestSourceBuild(runner)).rejects.toThrow(
      /committed source snapshot launcher/,
    );
  });

  it("computes a deterministic commit-bound scoped tree and package hashes", async () => {
    const { root, commit } = await fixtureRepo();
    const first = await computeSourceBuildAttestation(root, commit);
    const second = await computeSourceBuildAttestation(root, commit);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      version: 2,
      executionMode: "detached-commit-snapshot",
      commit,
      runner: "src/cli.ts",
      scopedPaths: [
        "src",
        "scripts/remote-entry.ts",
        "scripts/run-source-attested-render.sh",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.json",
      ],
    });
    expect(first.treeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.packageJsonSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.pnpmLockSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(validateSourceBuildAttestation(root, first)).resolves.toEqual(first);
  });

  it("recomputes and rejects a forged attestation for any named commit", async () => {
    const { root, commit } = await fixtureRepo();
    const attestation = await computeSourceBuildAttestation(root, commit);
    await expect(
      validateSourceBuildAttestation(root, { ...attestation, treeSha256: "0".repeat(64) }),
    ).rejects.toThrow(/does not match commit/);
  });

  it("requires the actual tracked src/cli.ts runner and a clean scoped worktree", async () => {
    const fixture = await fixtureRepo();
    const { root, runner } = fixture;
    await expect(withSnapshotLaunch(fixture, () => attestSourceBuild(runner))).resolves.toMatchObject({
      attestation: { runner: "src/cli.ts" },
      repoRoot: root,
      runnerPath: runner,
    });

    await expect(
      withSnapshotLaunch(fixture, () => attestSourceBuild(join(root, "src/helper.ts"))),
    ).rejects.toThrow(/src\/cli\.ts runner/);

    await chmod(join(root, "src/helper.ts"), 0o644);
    await writeFile(join(root, "src/helper.ts"), "changed\n");
    await chmod(join(root, "src/helper.ts"), 0o444);
    await expect(
      withSnapshotLaunch(fixture, () => attestSourceBuild(runner)),
    ).rejects.toThrow(/working-tree bytes differ/);

    await git(root, "add", "src/helper.ts");
    await expect(
      withSnapshotLaunch(fixture, () => attestSourceBuild(runner)),
    ).rejects.toThrow(/Git index differs from commit/);
  });

  it("rejects every extra scoped file but permits ignored artifacts outside the scope", async () => {
    const fixture = await fixtureRepo();
    const { root, runner } = fixture;
    await chmod(root, 0o755);
    await mkdir(join(root, "out"));
    await writeFile(join(root, "out/ignored.tmp"), "ignored capture output\n");
    await chmod(root, 0o555);
    await expect(
      withSnapshotLaunch(fixture, () => attestSourceBuild(runner)),
    ).resolves.toBeDefined();

    await chmod(join(root, "src"), 0o755);
    await writeFile(join(root, "src/ignored.tmp"), "ignored\n");
    await chmod(join(root, "src/ignored.tmp"), 0o444);
    await chmod(join(root, "src"), 0o555);
    await expect(
      withSnapshotLaunch(fixture, () => attestSourceBuild(runner)),
    ).rejects.toThrow(/src\/ignored\.tmp/);
  });

  it("does not trust assume-unchanged or skip-worktree index flags", async () => {
    const assumed = await fixtureRepo();
    await git(assumed.root, "update-index", "--assume-unchanged", "src/cli.ts");
    await chmod(assumed.runner, 0o644);
    await writeFile(assumed.runner, 'export const runner = "forged";\n');
    await chmod(assumed.runner, 0o444);
    await expect(
      withSnapshotLaunch(assumed, () => attestSourceBuild(assumed.runner)),
    ).rejects.toThrow(/assume-unchanged|working-tree bytes/);

    const skipped = await fixtureRepo();
    await git(skipped.root, "update-index", "--skip-worktree", "src/cli.ts");
    await chmod(skipped.runner, 0o644);
    await writeFile(skipped.runner, 'export const runner = "forged";\n');
    await chmod(skipped.runner, 0o444);
    await expect(
      withSnapshotLaunch(skipped, () => attestSourceBuild(skipped.runner)),
    ).rejects.toThrow(/skip-worktree|working-tree bytes/);
  });

  it("does not let inherited Git repository overrides attest a different repository", async () => {
    const victim = await fixtureRepo();
    const alternate = await fixtureRepo();
    const forgedRunner = 'export const runner = "forged";\n';
    await writeFile(join(alternate.authorityRoot, "src/cli.ts"), forgedRunner);
    await git(alternate.authorityRoot, "add", "src/cli.ts");
    await git(alternate.authorityRoot, "commit", "-m", "forged alternate source");
    await chmod(victim.runner, 0o644);
    await writeFile(victim.runner, forgedRunner);
    await chmod(victim.runner, 0o444);

    const overrides = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      GIT_COMMON_DIR: process.env.GIT_COMMON_DIR,
    };
    process.env.GIT_DIR = join(alternate.authorityRoot, ".git");
    process.env.GIT_WORK_TREE = victim.root;
    process.env.GIT_COMMON_DIR = join(alternate.authorityRoot, ".git");
    try {
      await expect(
        withSnapshotLaunch(victim, () => attestSourceBuild(victim.runner)),
      ).rejects.toThrow(/working-tree bytes differ from commit/);
    } finally {
      for (const [name, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it("does not execute caller-selected global Git configuration", async () => {
    const fixture = await fixtureRepo();
    const hostileHome = await mkdtemp(join(tmpdir(), "source-build-hostile-home-"));
    const fsmonitorMarker = join(hostileHome, "fsmonitor-ran");
    const fsmonitor = join(hostileHome, "fsmonitor.sh");
    await writeFile(
      fsmonitor,
      `#!/bin/sh\n: > "${fsmonitorMarker}"\nexit 0\n`,
    );
    await chmod(fsmonitor, 0o755);
    await writeFile(
      join(hostileHome, ".gitconfig"),
      `[core]\n\tfsmonitor = ${fsmonitor}\n`,
    );

    const previousHome = process.env.HOME;
    const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.HOME = hostileHome;
    process.env.XDG_CONFIG_HOME = hostileHome;
    try {
      await expect(
        withSnapshotLaunch(fixture, () => attestSourceBuild(fixture.runner)),
      ).resolves.toBeDefined();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    }
    expect(existsSync(fsmonitorMarker)).toBe(false);
  });

  it("blocks a completed render claim when the scoped source changes after admission", async () => {
    const fixture = await fixtureRepo();
    const { root, runner } = fixture;
    const session = await withSnapshotLaunch(
      fixture,
      () => attestSourceBuild(runner),
    );
    await chmod(join(root, "src/helper.ts"), 0o644);
    await writeFile(join(root, "src/helper.ts"), "changed during render\n");

    await expect(assertSourceBuildUnchanged(session)).rejects.toThrow(
      /source changed during render/,
    );
  });

  it("rejects a structurally copied source-build session", async () => {
    const fixture = await fixtureRepo();
    const session = await withSnapshotLaunch(
      fixture,
      () => attestSourceBuild(fixture.runner),
    );
    const forged = {
      ...session,
      attestation: {
        ...session.attestation,
        scopedPaths: [...session.attestation.scopedPaths],
      },
    };

    await expect(
      assertSourceBuildUnchanged(forged as unknown as SourceBuildSession),
    ).rejects.toThrow(
      /issued by this committed snapshot module/,
    );
  });
});
