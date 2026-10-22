---
title: Retire command helpers when the leader exits
date: 2026-10-21
category: docs/solutions/incidents
module: command voice and aligner execution
problem_type: degradation
component: runCommand
severity: medium
applies_when:
  - A voice, aligner or render command spawns helpers in its own POSIX process group
  - The command leader exits while a helper remains running
symptoms:
  - The command resolves or rejects but a background helper keeps running
  - Tests need their own cleanup after the command has completed
root_cause: completion_removed_group_ownership_before_helper_cleanup
resolution_type: code_fix
tags: [process-lifecycle, command-provider, cleanup, contrastive-refinement]
---

## Reproduced defect

At source `4ab0243`, command completion removed its group from the cleanup
registry and closed its output streams. Group cleanup at the exit event ran
only after a timeout. A helper could survive either a successful or failed
command. The existing background-helper test cleaned up the helper in its own
`finally` block, concealing the missing product cleanup.

This was reproduced against the actual command implementation with disposable
local processes. It is not a claim that a particular production render leaked.

## Repair and reusable lesson

On every leader exit, stop the remaining members of that command's own process
group before forgetting it. Keep the leader's original success, error message,
timeout and interrupt result. Preserve the bounded output-drain behavior.

A prior process-lifecycle lesson informed the check: successful completion is
not evidence that child resources have been retired. Verify lifecycle state at
completion, without relying on another request or a test's emergency cleanup.
Here Node already reaps the leader; the missing step was group cleanup, so a
new polling service or a Python-style reaper would solve the wrong problem.

Apply this only to short-lived commands whose helpers belong to the invocation.
It is not a host-wide process reaper. Helpers that establish another group or
session must be stopped by their command before it exits. Other process groups
remain outside this cleanup scope. See [the voice guide](../guide/voice.md).

## Same-check verification

Three frozen acceptance checks ran against the baseline and repaired source:

- Success with a helper holding output pipes: leaked before, retired after.
- Failure with a helper that closed its pipes: leaked before, retired after;
  the original exit code and diagnostic remained intact.
- Ordinary success: passed before and after.

Each check also kept an unrelated process alive. Baseline: one pass and two
behavioral failures. Candidate: three passes, zero errors, identical test IDs.
The independent evaluator command reported `IMPROVED` in 4.96 seconds. This is
a behavior comparison, not an independent-author review or a controlled
measurement of development time or token savings.

Frozen manifest SHA-256:
`1124a7b6a5d9fd0d91289711dad41d8a143db734c4f405811530f540af8f03ed`.
Comparison report SHA-256:
`4a201762e7573f8ad72c879254999bcca28bebdbdfb1d6fd14b6fe5b8b615079`.
Candidate command source SHA-256:
`da52d53e725c1d58b227e1954546bca945a26f05614e01a1a3fcd7fa40c2e004`.
The frozen bundle and reports are retained in the operator's repair evidence.

The permanent repository regressions assert helper termination before emergency
test cleanup, and preserve the failing command's diagnostic. Repository
validation: 577 tests passed, one optional Whisper integration check skipped;
typecheck and build passed. Existing command-voice render smokes also passed.

## Review refinement

Review of the first repair (`af8f5b8`) exposed a compatibility gap in its timing:
a helper that wrote a diagnostic 80 ms after its leader exited was killed before
the existing 250 ms output drain could collect that text. The same native probe
passed against the pre-repair source and failed against the first repair.
Ordinary completion now retires helpers at the end of that bounded drain;
timeout cleanup remains immediate. Already-settled callbacks do not signal again.

A fault-injection probe also showed that a cleanup permission error was silent.
Signal errors other than an absent group now warn without replacing the command's
original result. Commands remain responsible for helpers whose changed credentials
prevent signalling, including partial-permission groups. The Linux test probe
distinguishes terminated zombies from running helpers instead of relying solely
on signal zero.

Both new regressions passed after failing before these refinements. The original
frozen comparison was repeated unchanged: baseline one of three, revised source
three of three, with the unrelated-process controls preserved. Revised source
SHA-256: `2bfc6ebd04daeb8b08c0dbd61899415147cea718fd3b05a1fc20c965ae2423c6`.
Revised comparison report SHA-256:
`dfad677a4327dd9e93e00b042029dbfd8c2032a82b93b920b32989e01545eef1`.
This refinement demonstrates why a passing narrow comparison does not substitute
for review of adjacent compatibility behavior.
Revised validation: 579 tests passed, one optional Whisper integration skipped;
typecheck and build passed.

## Rollout and rollback

This repair is source-only until reviewed and merged. Run `pnpm test`,
`pnpm typecheck` and `pnpm build` before activation. After adopting the revision,
check command completion and resource retirement together; do not use an empty
log or successful return as process-state evidence.

Revert the scoped repair if a command relied on helpers persisting after its
leader exited, and fix that command's ownership contract before readoption.
Preserve the comparison evidence. No GPU qualification, schedule, provider,
credential or installed CLI was changed by this repair exercise.
