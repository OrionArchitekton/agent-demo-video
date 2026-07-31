---
verified: 2026-07-30
review_after: 2026-10-30
topics: [factory-ai-at-work, video, gate-01, production, shorts, elevenlabs]
references:
  - demos/factory-ai-at-work/gate-01/README.md
  - demos/factory-ai-at-work/gate-01/CAPTURE_PLAN.md
  - demos/factory-ai-at-work/gate-01/CLAIM_LEDGER.md
  - demos/factory-ai-at-work/gate-01/PUBLISHING.md
  - demos/factory-ai-at-work/gate-01/PRODUCTION_RECEIPT_TEMPLATE.md
  - demos/factory-ai-at-work/gate-01/master/demo.config.json
  - demos/factory-ai-at-work/gate-01/master/DEMO_SCRIPT.md
  - demos/factory-ai-at-work/gate-01/cuts/cut-a/demo.config.json
  - demos/factory-ai-at-work/gate-01/cuts/cut-a/DEMO_SCRIPT.md
  - demos/factory-ai-at-work/gate-01/cuts/cut-b/demo.config.json
  - demos/factory-ai-at-work/gate-01/cuts/cut-b/DEMO_SCRIPT.md
  - demos/factory-ai-at-work/gate-01/cuts/cut-c/demo.config.json
  - demos/factory-ai-at-work/gate-01/cuts/cut-c/DEMO_SCRIPT.md
  - src/cli.ts
  - src/framing.ts
  - src/pipeline.ts
  - src/preflight.ts
  - src/provenance.ts
  - src/render.ts
  - src/source-build.ts
  - src/git-environment.ts
  - scripts/run-source-attested-render.sh
  - scripts/cleanup-stale-render-input-root.sh
  - scripts/validate-factory-ai-at-work-inputs.ts
  - scripts/validate-factory-ai-at-work-receipt.sh
  - scripts/promote-factory-ai-at-work-attempt.sh
  - tests/factory-ai-at-work-pack.test.ts
  - tests/prebaked-input-binding.test.ts
  - tests/pipeline.smoke.test.ts
  - tests/preflight.smoke.test.ts
  - tests/render-aspect-guard.test.ts
  - specs/factory-ai-at-work-gate-01-production-pack-spec.md
---

# Factory AI at Work Gate 1 Production

This runbook renders the first channel gate episode and its three portrait
cuts. It stops at reviewed media artifacts. Upload, metadata mutation, and
public publishing are separate operator actions.

## Preconditions

1. Work from a clean checkout of the merged pack on a Linux filesystem under
   Linux or WSL. Do not place attempts on `/mnt/c` or another DrvFs mount;
   immutable `--out` runs authenticate Unix ownership, mode, birth time, and
   Linux directory handles. This protects against accidental or cooperating
   path reuse, not a malicious process running with the same Unix user.
2. Install the locked dependencies and verify ffmpeg, ffprobe, Chromium, and
   the pinned caption font are available. Select a canonical root-owned Node
   binary beneath root-owned, non-writable ancestors and the bundled
   `pnpm.cjs` entrypoint from the operator-approved toolchain. Do not derive
   either production path from the caller's `PATH`. The pnpm entrypoint must
   report the repository-pinned `9.12.0`.
3. Capture every source listed in `CAPTURE_PLAN.md` from a real run. Keep the
   source media in the ignored pack-local `clips/` directories.
4. Prepare the run-dependent evidence required by
   `PRODUCTION_RECEIPT_TEMPLATE.md`. Do not proceed if the file count, prompt,
   formula result, session state, or device proof differs from the narration.
5. Re-open every primary source in `CLAIM_LEDGER.md` and update or cut any
   claim that drifted since its verification date.
6. Obtain the ElevenLabs key only through the normal secret manager at render
   time. Never place it in this repository or a config file.

## Rollout

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- tests/factory-ai-at-work-pack.test.ts
pnpm typecheck
pnpm build
```

Confirm the fail-closed gate sees all clips:

```bash
set -euo pipefail

FACTORY_REHEARSAL_ID="$(date -u +%Y%m%dT%H%M%SZ)-rehearsal"
FACTORY_REHEARSAL_ROOT="out/factory-ai-at-work/gate-01/attempts/${FACTORY_REHEARSAL_ID}"
mkdir -p -- "$(dirname -- "$FACTORY_REHEARSAL_ROOT")"
mkdir "$FACTORY_REHEARSAL_ROOT"
FAKE_TTS=1 pnpm demo demos/factory-ai-at-work/gate-01/master/demo.config.json \
  --out "$FACTORY_REHEARSAL_ROOT/master"
FAKE_TTS=1 pnpm demo demos/factory-ai-at-work/gate-01/cuts/cut-a/demo.config.json \
  --out "$FACTORY_REHEARSAL_ROOT/cut-a"
FAKE_TTS=1 pnpm demo demos/factory-ai-at-work/gate-01/cuts/cut-b/demo.config.json \
  --out "$FACTORY_REHEARSAL_ROOT/cut-b"
FAKE_TTS=1 pnpm demo demos/factory-ai-at-work/gate-01/cuts/cut-c/demo.config.json \
  --out "$FACTORY_REHEARSAL_ROOT/cut-c"
```

The rehearsal must fail before audio creation if any clip is absent. Never use
`--no-preflight` to force a production render. Rehearsal output is not a
production attempt and is never promoted.

After the keyless rehearsal passes, render through the approved secret-manager
wrapper into a different fresh attempt root:

```bash
set -euo pipefail

FACTORY_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-real"
FACTORY_ATTEMPT_ROOT="out/factory-ai-at-work/gate-01/attempts/${FACTORY_RUN_ID}"
FACTORY_REVIEWED_ROOT="out/factory-ai-at-work/gate-01/reviewed/${FACTORY_RUN_ID}"
mkdir -p -- "$(dirname -- "$FACTORY_ATTEMPT_ROOT")"
mkdir "$FACTORY_ATTEMPT_ROOT"
FACTORY_ATTEMPT_ABS="$(realpath "$FACTORY_ATTEMPT_ROOT")"
test ! -e "$FACTORY_REVIEWED_ROOT"
cp demos/factory-ai-at-work/gate-01/PRODUCTION_RECEIPT_TEMPLATE.md \
  "$FACTORY_ATTEMPT_ROOT/PRODUCTION_RECEIPT.md"
mkdir -p \
  "$FACTORY_ATTEMPT_ROOT/evidence/clips/master" \
  "$FACTORY_ATTEMPT_ROOT/evidence/clips/cut-a" \
  "$FACTORY_ATTEMPT_ROOT/evidence/clips/cut-b" \
  "$FACTORY_ATTEMPT_ROOT/evidence/clips/cut-c" \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/master" \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/cuts/cut-a" \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/cuts/cut-b" \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/cuts/cut-c"
cp -- \
  demos/factory-ai-at-work/gate-01/clips/master/01-cold-open.mp4 \
  demos/factory-ai-at-work/gate-01/clips/master/02-roadmap.mp4 \
  demos/factory-ai-at-work/gate-01/clips/master/03-setup.mp4 \
  demos/factory-ai-at-work/gate-01/clips/master/04-install-it-right.mp4 \
  demos/factory-ai-at-work/gate-01/clips/master/05-first-real-task.mp4 \
  demos/factory-ai-at-work/gate-01/clips/master/06-where-it-runs.mp4 \
  demos/factory-ai-at-work/gate-01/clips/master/07-anywhere-on-a-schedule.mp4 \
  demos/factory-ai-at-work/gate-01/clips/master/08-recap.mp4 \
  demos/factory-ai-at-work/gate-01/clips/master/09-next.mp4 \
  "$FACTORY_ATTEMPT_ROOT/evidence/clips/master/"
cp -- demos/factory-ai-at-work/gate-01/clips/cut-a/cut-a-install.mp4 \
  "$FACTORY_ATTEMPT_ROOT/evidence/clips/cut-a/"
cp -- demos/factory-ai-at-work/gate-01/clips/cut-b/cut-b-real-job.mp4 \
  "$FACTORY_ATTEMPT_ROOT/evidence/clips/cut-b/"
cp -- demos/factory-ai-at-work/gate-01/clips/cut-c/cut-c-remote.mp4 \
  "$FACTORY_ATTEMPT_ROOT/evidence/clips/cut-c/"
cp -- \
  demos/factory-ai-at-work/gate-01/CAPTURE_PLAN.md \
  demos/factory-ai-at-work/gate-01/CLAIM_LEDGER.md \
  demos/factory-ai-at-work/gate-01/PUBLISHING.md \
  demos/factory-ai-at-work/gate-01/README.md \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/"
cp -- \
  demos/factory-ai-at-work/gate-01/master/DEMO_SCRIPT.md \
  demos/factory-ai-at-work/gate-01/master/demo.config.json \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/master/"
cp -- \
  demos/factory-ai-at-work/gate-01/cuts/cut-a/DEMO_SCRIPT.md \
  demos/factory-ai-at-work/gate-01/cuts/cut-a/demo.config.json \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/cuts/cut-a/"
cp -- \
  demos/factory-ai-at-work/gate-01/cuts/cut-b/DEMO_SCRIPT.md \
  demos/factory-ai-at-work/gate-01/cuts/cut-b/demo.config.json \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/cuts/cut-b/"
cp -- \
  demos/factory-ai-at-work/gate-01/cuts/cut-c/DEMO_SCRIPT.md \
  demos/factory-ai-at-work/gate-01/cuts/cut-c/demo.config.json \
  "$FACTORY_ATTEMPT_ROOT/evidence/source/cuts/cut-c/"
chmod -R a-w "$FACTORY_ATTEMPT_ROOT/evidence"

# This shell is the source-admission root of trust. Remove every Git authority
# override, use fixed system-tool paths, fix one commit, and execute the
# launcher bytes from that commit rather than the mutable checkout copy.
while IFS= read -r FACTORY_GIT_ENVIRONMENT_NAME; do
  case "$FACTORY_GIT_ENVIRONMENT_NAME" in
    GIT_*) unset "$FACTORY_GIT_ENVIRONMENT_NAME" ;;
  esac
done < <(compgen -e)
unset FACTORY_GIT_ENVIRONMENT_NAME
: "${FACTORY_NODE_BIN:?set the operator-approved canonical root-owned Node binary}"
: "${FACTORY_PNPM_CLI:?set the operator-approved canonical absolute bundled pnpm.cjs path}"
FACTORY_NODE_BIN="$(/usr/bin/realpath -e -- "$FACTORY_NODE_BIN")"
FACTORY_PNPM_CLI="$(/usr/bin/realpath -e -- "$FACTORY_PNPM_CLI")"
test -x "$FACTORY_NODE_BIN"
test "$(/usr/bin/stat -c '%u' -- "$FACTORY_NODE_BIN")" = 0
test "$((8#$(/usr/bin/stat -c '%a' -- "$FACTORY_NODE_BIN") & 0022))" = 0
FACTORY_NODE_PARENT="$(/usr/bin/dirname -- "$FACTORY_NODE_BIN")"
while true; do
  test "$(/usr/bin/stat -c '%u' -- "$FACTORY_NODE_PARENT")" = 0
  test "$((8#$(/usr/bin/stat -c '%a' -- "$FACTORY_NODE_PARENT") & 0022))" = 0
  test "$FACTORY_NODE_PARENT" = / && break
  FACTORY_NODE_PARENT="$(/usr/bin/dirname -- "$FACTORY_NODE_PARENT")"
done
unset FACTORY_NODE_PARENT
test -f "$FACTORY_PNPM_CLI"
test "$("$FACTORY_NODE_BIN" "$FACTORY_PNPM_CLI" --version)" = "9.12.0"
/usr/bin/sha256sum -- "$FACTORY_NODE_BIN" "$FACTORY_PNPM_CLI"
factory_authority_git() {
  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    GIT_ATTR_NOSYSTEM=1 \
    /usr/bin/git --no-replace-objects \
      -c core.hooksPath=/dev/null \
      -c core.fsmonitor=false \
      "$@"
}
FACTORY_SOURCE_REPO="$(
  factory_authority_git rev-parse --show-toplevel
)"
FACTORY_SOURCE_REPO="$(/usr/bin/realpath -e -- "$FACTORY_SOURCE_REPO")"
FACTORY_SOURCE_COMMIT="$(
  factory_authority_git -C "$FACTORY_SOURCE_REPO" rev-parse HEAD
)"
factory_attested_render() {
  factory_authority_git \
    -C "$FACTORY_SOURCE_REPO" show \
    "${FACTORY_SOURCE_COMMIT}:scripts/run-source-attested-render.sh" |
    PATH=/usr/bin:/bin LD_PRELOAD= LD_AUDIT= LD_LIBRARY_PATH= \
    /usr/bin/doppler run -p claude-code-use -c prd -- \
      /usr/bin/bash --noprofile --norc -p -s -- \
        "$FACTORY_SOURCE_REPO" \
        "$FACTORY_SOURCE_COMMIT" \
        --node-bin "$FACTORY_NODE_BIN" \
        --pnpm-cli "$FACTORY_PNPM_CLI" \
        -- \
        "$@"
}

factory_attested_render \
  "$FACTORY_ATTEMPT_ABS/evidence/source/master/demo.config.json" \
  --script "$FACTORY_ATTEMPT_ABS/evidence/source/master/DEMO_SCRIPT.md" \
  --clips-dir "$FACTORY_ATTEMPT_ABS/evidence/clips/master" \
  --out "$FACTORY_ATTEMPT_ABS/master"
factory_attested_render \
  "$FACTORY_ATTEMPT_ABS/evidence/source/cuts/cut-a/demo.config.json" \
  --script "$FACTORY_ATTEMPT_ABS/evidence/source/cuts/cut-a/DEMO_SCRIPT.md" \
  --clips-dir "$FACTORY_ATTEMPT_ABS/evidence/clips/cut-a" \
  --out "$FACTORY_ATTEMPT_ABS/cut-a"
factory_attested_render \
  "$FACTORY_ATTEMPT_ABS/evidence/source/cuts/cut-b/demo.config.json" \
  --script "$FACTORY_ATTEMPT_ABS/evidence/source/cuts/cut-b/DEMO_SCRIPT.md" \
  --clips-dir "$FACTORY_ATTEMPT_ABS/evidence/clips/cut-b" \
  --out "$FACTORY_ATTEMPT_ABS/cut-b"
factory_attested_render \
  "$FACTORY_ATTEMPT_ABS/evidence/source/cuts/cut-c/demo.config.json" \
  --script "$FACTORY_ATTEMPT_ABS/evidence/source/cuts/cut-c/DEMO_SCRIPT.md" \
  --clips-dir "$FACTORY_ATTEMPT_ABS/evidence/clips/cut-c" \
  --out "$FACTORY_ATTEMPT_ABS/cut-c"
```

The copied configs, scripts, and clips are the production inputs. The per-run
`--script` and `--clips-dir` overrides ensure preflight and render consume those
attempt-owned bytes, not mutable pack-local filenames. The `--out` flag refuses
an existing target before changing it, keeps subsequent writes in a private
handle-bound directory, and publishes it only with a no-clobber rename on Linux
or WSL when the attempt is on a Linux filesystem. The authenticated zero-byte
claim remains inside each successful output as
`.agent-demo-video-output-claim`. The claim and staging checks cover accidental
or cooperating collisions; they do not isolate a process from another
malicious process with the same Unix identity. If any command fails, keep
the partial attempt outside `reviewed/`,
diagnose it, and start a new run ID. An interrupted process can leave an
exclusive claim file plus a hidden `.NAME.stage-*` sibling; quarantine both
after confirming the process is gone, then use a new run ID.

The committed launcher requires Bash privileged startup mode, which suppresses
`BASH_ENV` and imported functions before streamed bytes execute. It then fixes
`PATH` to system directories, admits only a canonical root-owned Node binary
beneath root-owned non-writable ancestors, uses an explicit package-manager
entrypoint, and pins both selected tool files by SHA-256 for the run. Every
authority-sensitive Git call ignores caller global and system configuration
and disables repository-local hooks and filesystem monitors. It
fixes one full commit, registers a private detached no-checkout worktree,
materializes the commit archive without checkout filters, rebuilds the detached
index, and compares every scoped file byte and executable bit directly with
that commit's Git objects. It installs the frozen dependency lock in a minimal
environment with no Doppler render secrets, caller npm/pnpm configuration,
lifecycle scripts, or pnpm hook files; its home, XDG config, and package store
are private to the disposable snapshot. It then freezes the scoped tree,
changes to that snapshot, and invokes the pinned `tsx` module through the
explicit Node binary and snapshot `tsconfig.json`. Only application execution
receives the render secret. The issued source session is valid only inside the
same snapshot module graph, and the pipeline binds its own module path before
claiming output. Direct mutable-checkout use
of `--attest-source-build` is refused. The report records snapshot execution,
the commit, scoped tree, package manifest, and dependency-lock hashes, and
rechecks the frozen source after render. Installed dependency bytes and system
tools remain part of the declared toolchain boundary rather than the repository
source attestation. Snapshot mode cannot be combined with remote rendering. Copy
`Source commit SHA` into the production receipt from
`master/render-report.json.sourceBuildAttestation.commit`; do not type an
independent `git rev-parse` value.

## Validation

For every output:

1. Require a `render-report.json` with `ttsMode: real`, the pinned voice and
   model, parity `ok: true`, a duration at or below its config cap, full config
   and script SHA-256 values, and one ordered full SHA-256 for every consumed
   prebaked clip.
2. Use ffprobe to confirm the master is 1920x1080 and each cut is 1080x1920,
   with both an audio and video stream.
3. Play the master and all three cuts from frame 1 through the final frame.
   Listen to every sentence, not a sample. Disposition every block against its
   delivery cue in `PRODUCTION_RECEIPT.md`; reject flat, clipped, silent,
   duplicated, dead-air, or abruptly cut narration.
4. Inspect captions at the first, middle, and final frame of every block. Keep
   text inside the title-safe area and verify the installed face is Liberation
   Sans.
5. Watch every source clip end to end for frozen, blank, login, notification,
   credential, account, and unrelated-file exposure.
6. Confirm the master cold-opens on the finished artifact and ends on a
   15-second disclosure card. Confirm each portrait cut has its own hook and
   payoff and stays at or below 60 seconds.
7. Generate chapter timestamps from the final real-voice master report, require
   every chapter to span at least 10 seconds, and spot check every timestamp
   against the first frame of that section.
8. Complete all twelve items in the copied production receipt with concrete
   evidence, Dan's review timestamps, disclosure-field answers and rationale,
   the full source commit copied from the snapshot-attested master report, the
   SHA-256 of the archived `evidence/source/CLAIM_LEDGER.md`, and an explicit
   `REVIEWED_FOR_PUBLISH_HANDOFF` or `REJECTED` decision.
   Local review does not establish a channel gate pass or authorize publishing.

Example probes:

```bash
ffprobe -v error -show_entries format=duration \
  -show_entries stream=codec_type,width,height,sample_aspect_ratio \
  -of json "$FACTORY_ATTEMPT_ROOT/master/final.mp4"
rg -n '[\u2013\u2014\u2015]' demos/factory-ai-at-work/gate-01
```

The dash scan returns no matches.

Require all four real receipts before promotion:

```bash
"$FACTORY_NODE_BIN" --input-type=module - "$FACTORY_ATTEMPT_ROOT" <<'NODE'
import { readFileSync } from "node:fs";
const root = process.argv[2];
for (const name of ["master", "cut-a", "cut-b", "cut-c"]) {
  const report = JSON.parse(
    readFileSync(`${root}/${name}/render-report.json`, "utf8"),
  );
  if (report.ttsMode !== "real") throw new Error(`${name}: TTS is not real`);
  if (report.voice.voiceId !== "AwstCxsCY8YE2KYw66By") {
    throw new Error(`${name}: wrong voice`);
  }
  if (report.voice.modelId !== "eleven_multilingual_v2") {
    throw new Error(`${name}: wrong voice model`);
  }
  if (
    report.voice.seed !== 42 ||
    report.voice.stability !== 0.5 ||
    report.voice.similarity !== 0.75
  ) {
    throw new Error(`${name}: wrong voice parameters`);
  }
  if (report.render.parity.ok !== true) throw new Error(`${name}: parity failed`);
  if (report.timeline.totalSec > report.limits.maxDurationSec) {
    throw new Error(`${name}: duration cap exceeded`);
  }
  if (report.preflight.ran !== true || report.preflight.declined !== false) {
    throw new Error(`${name}: preflight was not enforced`);
  }
}
console.log("all production receipts passed");
NODE
```

Generate and persist the measured YouTube chapter block:

```bash
"$FACTORY_NODE_BIN" --input-type=module - "$FACTORY_ATTEMPT_ROOT" \
  > "$FACTORY_ATTEMPT_ROOT/YOUTUBE_CHAPTERS.txt" <<'NODE'
import { readFileSync } from "node:fs";
const root = process.argv[2];
const { timeline } = JSON.parse(
  readFileSync(`${root}/master/render-report.json`, "utf8"),
);
const labels = new Map([
  ["01-cold-open", "What you'll build"],
  ["02-roadmap", "The 4 steps"],
  ["03-setup", "What you need"],
  ["04-install-it-right", "Step 1: Install it right (2 traps)"],
  ["05-first-real-task", "Step 2: First real task on real files"],
  ["06-where-it-runs", "Step 3: Where Cowork actually runs"],
  ["07-anywhere-on-a-schedule", "Step 4: Web, phone, and schedules"],
  ["08-recap", "Recap"],
  ["09-next", "What's next"],
]);
const lines = [];
const seen = new Set();
const chapterEntries = [];
for (const { shotId, startSec } of timeline.entries) {
  const label = labels.get(shotId);
  if (!label) continue;
  if (seen.has(shotId)) throw new Error(`duplicate chapter shot: ${shotId}`);
  seen.add(shotId);
  chapterEntries.push({ shotId, startSec });
  const sec = Math.floor(startSec);
  lines.push(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} ${label}`);
}
const missing = [...labels.keys()].filter((shotId) => !seen.has(shotId));
if (missing.length > 0) throw new Error(`missing chapter shots: ${missing.join(", ")}`);
for (const [index, entry] of chapterEntries.entries()) {
  const endSec = chapterEntries[index + 1]?.startSec ?? timeline.totalSec;
  const durationSec = endSec - entry.startSec;
  if (!Number.isFinite(durationSec) || durationSec < 10) {
    throw new Error(
      `chapter ${entry.shotId} is shorter than 10 seconds (${durationSec.toFixed(3)}s)`,
    );
  }
}
process.stdout.write(`${lines.join("\n")}\n`);
NODE
test -s "$FACTORY_ATTEMPT_ROOT/YOUTUBE_CHAPTERS.txt"
```

After all four outputs pass, use the closed-world promoter:

```bash
set -euo pipefail

LD_PRELOAD= LD_AUDIT= LD_LIBRARY_PATH= \
  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C \
  /usr/bin/bash --noprofile --norc -p \
  scripts/promote-factory-ai-at-work-attempt.sh \
  --node-bin "$FACTORY_NODE_BIN" \
  "$FACTORY_ATTEMPT_ROOT" \
  "$FACTORY_REVIEWED_ROOT"
LD_PRELOAD= LD_AUDIT= LD_LIBRARY_PATH= \
  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C \
  /usr/bin/bash --noprofile --norc -p \
  scripts/promote-factory-ai-at-work-attempt.sh \
  --node-bin "$FACTORY_NODE_BIN" \
  --verify "$FACTORY_REVIEWED_ROOT"
```

The promoter rejects symlinks, special files, hard links, unexpected topology,
nested mounts, blank, hidden, or placeholder review evidence, and
cross-filesystem moves before permission mutation. Both the promoter and its
semantic receipt validator require privileged Bash startup, fix system-tool
lookup, and scrub caller shell, preload, Git, Node, ripgrep, and package-manager
injection variables. The operator command clears dynamic-loader variables
before Bash starts, then passes only the fixed path and locale in the
environment and the already-canonical root-owned Node binary as an explicit
operand. The promoter forwards that same binary to both semantic validation
phases. Both entrypoints require root-owned non-writable ancestry, bind the
file's canonical identity and digest across their functional Node probe, and
then trust the root-owned executable for semantic validation. The promoter
writes the sealed
`PRODUCTION_RECEIPT.sha256` manifest only after moving the authenticated pack
to a private same-filesystem name, makes the tree read-only, regenerates the
full regular-file path-plus-digest set, runs the semantic receipt validator,
probes each final for audio, video, geometry, SAR, and duration, and
independently recomputes the archived config, script, ordered clip-byte
digests, locale-independent manifest order, exact relative concat selections,
per-segment measured durations, timeline, and chapter evidence through
`scripts/validate-factory-ai-at-work-inputs.ts`. It moves through a private
destination-filesystem name and repeats the checks before and after the final
no-clobber rename. An added, removed, changed, or unrelated input therefore
breaks verification instead of remaining outside an open-set `sha256sum -c`
check. After the final reviewed-root verification commits success, a closed
stdout or full logging filesystem may suppress the status digest but cannot
turn that durable state into an unretryable failure; the following independent
`--verify` command still runs.

Only the reviewed root is eligible for a publishing handoff. The hash receipt
binds every attempt-owned source file and render artifact, including clips,
narration audio, intermediate media, final videos, captions, reports, chapters,
and the completed review receipt. Changing pack-local source or capture
filenames later does not invalidate an older reviewed attempt.

## Authorized upload boundary

Do not edit `PRODUCTION_RECEIPT.md` after promotion. Its publication approval
and channel status intentionally remain `NOT_REQUESTED` and `NOT_EVALUATED`.
This pack deliberately stops at immutable reviewed local evidence. It does not
upload, observe served state, maintain the three-video counter, or decide when
promotion and hub linking unlock. After Dan expressly authorizes publication,
use the ratified Factory AI at Work format and current operator state as the
sole channel authority. One full episode, including its required portrait cuts,
is one gate candidate; the cuts never count as additional episodes.

Verify the served master and all three cuts against the twelve-point channel
checklist. If any later observation finds a miss, make the affected episode
private immediately and record the escaped defect and counter reset in that
operator authority. Do not infer current served truth from this pre-upload
production receipt, and do not create a local counter or head file beside it.

## Monitoring

During render, watch for:

- missing-clip preflight findings;
- real TTS failures or an accidental `FAKE_TTS=1` environment;
- warnings that a clip is shorter than narration and has been frozen;
- parity or duration-cap failures;
- missing or stale `render-report.json`;
- an attempt path that already exists, which means the run ID must be changed
  rather than reused.

The launcher removes its detached source worktree on success, ordinary failure,
HUP, INT, and TERM. If cleanup fails after an otherwise successful render, the
launcher exits nonzero and prints the exact retained snapshot path. An
uncatchable process kill can also leave one private
`/tmp/agent-demo-video-source-snapshot.*/source` worktree registered. After
confirming no launcher or child render is running, remove only the exact path
reported by the launcher or `git worktree list`:

```bash
set -euo pipefail

FACTORY_STALE_SOURCE_SNAPSHOT="/tmp/agent-demo-video-source-snapshot.REPLACE/source"
case "$FACTORY_STALE_SOURCE_SNAPSHOT" in
  /tmp/agent-demo-video-source-snapshot.*/source) ;;
  *) echo "refusing unexpected snapshot path" >&2; exit 1 ;;
esac
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 \
  /usr/bin/git --no-replace-objects \
    -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    worktree list --porcelain
test -d "$FACTORY_STALE_SOURCE_SNAPSHOT"
chmod -R u+w -- "$FACTORY_STALE_SOURCE_SNAPSHOT"
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 \
  /usr/bin/git --no-replace-objects \
    -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    worktree remove --force "$FACTORY_STALE_SOURCE_SNAPSHOT"
rmdir -- "$(dirname -- "$FACTORY_STALE_SOURCE_SNAPSHOT")"
```

The render pipeline separately removes every private
`agent-demo-video-render-inputs-*` binding root on success, ordinary failure,
SIGINT, and SIGTERM. A cleanup failure is classified as
`PRIVATE_INPUT_CLEANUP_FAILED` and prints the exact retained binding path plus
the exact unpublished fresh-output staging path when one exists. If the render
itself also failed, the original pipeline error remains the primary error. If
rendering succeeded but binding cleanup failed, the fresh output claim stays
unpublished; do not promote that attempt.

An uncatchable kill or host loss can leave one of these binding roots behind.
After confirming that no render process is using the exact path, use the
bounded recovery helper. It removes one explicitly named, current-user-owned
0700 directory directly beneath the selected temporary root. The helper
requires the exact pipeline name
`agent-demo-video-render-inputs-<dead-pid>-<six-alphanumeric-characters>`, the
owned single-link 0400 created-by-pipeline marker, a trusted selected
temporary root and ancestor chain, no live `/proc/<pid>`, no target or
descendant mount, and a root at least the declared age (between 60 seconds and
seven days). It refuses symlinks, trailing-slash aliases, and unexpected
names:

```bash
set -euo pipefail

FACTORY_STALE_RENDER_INPUT_ROOT="/tmp/agent-demo-video-render-inputs-REPLACE"
LD_PRELOAD= LD_AUDIT= LD_LIBRARY_PATH= \
  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C \
  /usr/bin/bash --noprofile --norc -p \
  scripts/cleanup-stale-render-input-root.sh \
  --tmp-root /tmp \
  --older-than-seconds 3600 \
  "$FACTORY_STALE_RENDER_INPUT_ROOT"
```

The cleared loader environment protects Bash itself before the helper starts.
The empty environment and privileged Bash mode then suppress caller startup
files, imported functions, and inherited tool-selection variables before the
exact destructive path is evaluated. A successful deletion remains successful
even if the final stdout status write fails; the helper emits a best-effort
stderr notice instead of reporting that the already-committed removal failed.

The same-UID isolation boundary still applies: do not run recovery while a
render or another process under the same Unix identity can rename that path.

The pack promoter also handles ordinary failure, HUP, INT, and TERM by
promotion phase. Before sealing, it restores the authenticated writable pack to
the original attempt path with a no-clobber rename. After sealing begins, it
never makes the pack writable or guesses a destination; it prints the exact
authenticated `.promoting-*` or reviewed path retained for quarantine. Treat a
message that cannot authenticate either path as a stop condition and inspect
both named paths without mutating them.

After an authorized upload, monitor the platform artifacts themselves for
correct geometry, audio, captions, description disclosure, and chapter timing.
A local green render does not prove that the served uploads are correct.

## Rollback

1. Never promote a failed attempt. Leave it under `attempts/` as diagnostic
   evidence or move it to a dated local quarantine directory. If the promoter
   reports a retained `.promoting-*` path after sealing starts, preserve that
   read-only path exactly; do not rename or chmod it into another attempt.
2. Keep the previous reviewed directory byte-for-byte unchanged.
3. Restore the exact configs, scripts, and clips from the last reviewed root's
   `evidence/` tree; its recorded source commit provides repository context.
4. Re-run the keyless rehearsal, real render, and full validation sequence
   with new rehearsal and production run IDs.
5. If an upload already occurred, use the platform's reversible visibility
   control to make it private while correcting it. Preserve the reviewed source
   evidence and record the escaped defect in the channel operator authority.
6. Public promotion remains locked until the ratified channel authority records
   three consecutive clean episode passes. This Gate 1 pack never changes that
   state itself.
