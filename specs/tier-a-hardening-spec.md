# Tier A hardening - spec

Five changes that close silent-failure paths in demo rendering. Each one fixes a failure the
pipeline has already produced in a real render, not a hypothetical. Sourced from the 2026-07-25
benchmark against two external video-production systems.

## Problem

The pipeline can complete successfully and still ship a defective video. Its only automated verdict
is a post-render structural parity check (segment count, total duration, audio/video drift), so
every failure below exits zero:

- narration is synthesised with no voice at all, because the API key was absent rather than the
  silent mode being requested;
- a shot is recorded before the page has painted, producing a blank segment;
- the finished video exceeds the length limit of the event it was made for, discovered only after
  the full render has been paid for;
- a re-render of an unchanged script produces a materially different runtime, with no record of
  what inputs produced the original;
- a misspelled configuration key is silently ignored, so a deliberate remedy for a known defect
  never takes effect.

## Scenarios

### S1 - Silent narration is refused

Given a demo configuration and no narration API key available,
when the operator renders without explicitly requesting silent mode,
then the render stops before spending anything, and the message names the missing credential and
how to supply it.

Given the operator explicitly requests silent mode,
when the render runs,
then it proceeds with estimated-duration silent audio exactly as before, and the resolved narration
mode appears in the run's report.

**Acceptance:** an absent credential can no longer produce a finished video. Requesting silent mode
explicitly remains a first-class, documented workflow.

### S2 - A shot waits for the page to be ready

Given a shot that navigates to a page whose fonts or images have not finished loading,
when the recording for that shot begins,
then it begins only after the page reports its fonts ready and its visible images decoded, or after
a bounded settle budget elapses.

Given a page that never becomes ready within the budget,
when the budget elapses,
then recording proceeds anyway and the run emits a warning naming the shot and the reason.

**Acceptance:** readiness is a property of the pipeline, not something each script author must
remember to hand-author. A slow page degrades to a warning, never an aborted paid render.

*Engine limitation, stated rather than hidden:* this holds for the default screencast engine, where
the opening navigation and settle are hoisted ahead of the recorder starting. On the legacy
`recordvideo` engine capture is bound at context creation, so the settle shifts the unsettled frames
later within a fixed-length segment instead of excluding them. Closing that would mean rebuilding
the context per shot; the legacy engine is an explicit escape hatch and was left as-is.

*Divergence from the original draft, recorded per the same-PR spec rule:* the warning is emitted on
the run's output stream rather than carried in the render report. Threading a warning channel out of
the capture driver would have changed a signature used at three call sites for no gain in operator
visibility, since the warning names the shot either way. Revisit if the report ever becomes the
primary operator surface.

### S3 - The length limit is declarable and checked before spending

Given an event with a length limit shorter than the default,
when the operator declares that limit in the configuration,
then the limit is enforced by the same check that enforces the default.

Given a rehearsal run in silent mode,
when the assembled runtime exceeds the declared limit,
then the run fails and names the overage, before any narration has been purchased.

**Acceptance:** the limit is a configurable property of a demo rather than a fixed constant, and a
keyless rehearsal surfaces an overage before narration is purchased.

*Correction, recorded during review:* the rehearsal is an ESTIMATE, not a guarantee. Keyless
narration length is a flat words-per-minute estimate and capture dwells to that estimate, so the
rehearsal measures the estimate rather than real narration, and real output has run 19-30% longer.
Budget to roughly 75% of the cap. The check is authoritative only post-render.

### S4 - A finished render records what produced it

Given a completed render,
when it finishes,
then it writes a report naming the resolved narration voice and model, the versions of the
tools that rendered it, digests of the configuration and script, and the per-shot timeline.

**Acceptance:** "is this video reproducible from the current script?" is answerable from the
render's own output. A changed default that alters runtime is visible by comparing two reports.

### S5 - An unrecognised configuration key is rejected

Given a configuration containing a key the schema does not define,
when it is loaded,
then loading fails and names the offending key.

**Acceptance:** a misspelled remedy fails loudly instead of silently applying the default it was
written to override.

## Out of scope

Aesthetic scoring, pacing analysis, frame sampling, golden-baseline comparison, cursor and easing
craft, and platform delivery profiles. Each was considered and deferred; the benchmark records why.

## Test seams

Preferred seam is the smallest one that exercises the behaviour end to end. Named per scenario so
testability is decided here rather than during implementation:

- **S1, S3, S5** - the pure modules that own each decision (narration-mode resolution, parity
  verification, configuration loading), driven directly. These need no browser and no ffmpeg.
- **S2** - the readiness helper driven directly with a stubbed page. Chosen over a real-browser
  fixture because the load-bearing risk is the fail-open contract (never-settles, probe-throws,
  bounded budget), and a real browser cannot deterministically reproduce "fonts never become
  ready". The existing hermetic smoke render already exercises the wired path end to end.
- **S4** - the render entry point, asserting on the emitted report file.

One additional end-to-end assertion covers S1 and S3 together through the existing keyless
smoke-render seam, because the interaction between silent mode and the pre-spend limit is the
scenario an operator actually runs.

## Verification

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
