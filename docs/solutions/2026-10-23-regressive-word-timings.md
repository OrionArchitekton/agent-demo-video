---
title: Reject backward timestamps without rejecting valid overlapping words
date: 2026-10-23
category: docs/solutions/incidents
module: command voice and aligner timings
problem_type: data_integrity
component: readWordsFile
severity: medium
applies_when:
  - A command voice or aligner supplies JSON word timestamps
  - Individual word intervals are valid but their starts or ends move backward
symptoms:
  - Invalid timing order reaches caption alignment instead of a producer error
root_cause: validation_checked_each_interval_but_not_sequence_order
resolution_type: code_fix
tags: [command-provider, captions, word-timings, contrastive-refinement]
---

## Reproduced defect and repair

At `6bc6582`, the timing reader checked finite nonnegative intervals with
`end >= start`, but accepted sequences with a backward start or end. The repair
checks both sequences independently before per-shot alignment can normalize the data.
It names the provider and zero-based offending index. Malformed provider data
does not fall through to an aligner; malformed aligner data does not fall through
to estimated timings. Missing timing data keeps its existing fallback. The
finished-video transcript check retains its existing advisory error contract.

Do not require the next start to be greater than the previous end. Ordered
overlaps and equal timestamps are legitimate. Do not sort words to hide a
producer defect, because captions must preserve spoken word order.

## Reused lesson and comparison

The prior [command-helper repair](2026-10-21-command-helper-cleanup.md) showed
that a fix passing narrow failure checks could break adjacent valid behavior.
Reuse that compatibility-control technique here, not its process-cleanup code.
An initial stricter alternative rejected overlap and passed only three of five
frozen checks. The independent start/end ordering check passes all five.
The original source passes two of the same five checks.

The frozen checks invoke the actual timing reader and command `synthShot` path.
They cover backward start, backward end, unchanged ordered overlap, command
rejection and command acceptance. The author created these external mechanical
checks; they are not an independent-author experiment or randomized comparison
of agents with and without lessons. The receipt binds declared source files,
lesson bytes and the adopted change. Undeclared installed dependencies remain
outside that integrity boundary.

The normal `pnpm demo` workflow separately rendered a local fixture MP4 with
ordered overlapping provider timings and rejected regressive provider timings
before final media. The fixtures use synthetic silent audio and a local test
page. This establishes pipeline behavior, not narration or creative quality.

The provider guide reused the same lesson to explain both failure and valid
overlap cases. Two fresh reader contexts received the same five questions and
one draft each. The original supported zero answers; the revised guide supported
all five, adding 140 words in the first revision. A subsequent reader recheck
confirmed all five answers and clear advisory transcript-check scope after review
clarification. This measures answer coverage for that guide, not
general writing quality or authoring efficiency.

Task elapsed time, tokens and cost were not measured. The effort record retains
nulls, plus one explicitly defined behavioral revision from the overstrict
alternative to the compatible repair. Evaluator duration is check time only.

## Verification and adoption

The 52 focused timing/lifecycle/provider tests pass; typecheck and both CLI
builds pass. A full run passed 586 tests with one optional skip and failed an
unrelated promotion-interruption race; all seven tests in that file passed in
isolation. An earlier full run exposed its separate umask-sensitive fake-pnpm
fixture; rerunning that case under `umask 022` passed. Neither unrelated test nor
the runtime launcher was changed. Full-suite flakiness remains a limitation.

Frozen manifest SHA-256:
`afc98a122b9eb952fc4ed1061901fe2871d220f85633cdc6b9c5e6f0e142e441`.
Repaired command source SHA-256:
`77a246f098b1f5d6f8b0a292ca0954b4e0b2efdab37351cd6907d57899a50ccb`.
Detailed comparison, native CLI readback, reader responses and effort evidence
are retained in the operator's `workflow-lesson-reuse-20261023` report.

This is a source proposal until approved merge and rebuild. See the
[timing runbook](../runbooks/regressive-word-timings.md) for diagnosis,
verification and rollback. No GPU qualification or shared runtime was changed.
