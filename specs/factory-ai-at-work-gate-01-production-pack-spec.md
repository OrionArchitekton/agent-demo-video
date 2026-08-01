# Factory AI at Work Gate 1 Production Pack

Status: active

## Intent

The first `Dan Mercede | AI at Work` gate episode has an approved production
script but no versioned input contract for the video pipeline. The episode must
be reproducible as one landscape master and three portrait cuts without
committing credentials, authenticated browser state, captured footage, rendered
media, or publish state.

The pack turns the approved script into executable pipeline inputs while staying
fail-closed: every screen is a declared operator-supplied capture, and a missing
capture stops before narration spend.

## Vocabulary

- **master**: the landscape YouTube episode.
- **cut**: one self-contained portrait video derived from a candidate selected
  in the approved episode script.
- **capture contract**: the required clip filename, geometry, and evidence job
  that the operator must satisfy with a real recording.
- **production pack**: the four configs, four manifests, capture contract,
  publishing copy, versioned production receipt, and operator runbook that
  reproduce Gate 1.

## Scenarios

### S1 - Artifact-first master with an end card

Given the Gate 1 master config, when the pipeline builds its segment plan, then
the first frame is the finished Cowork artifact rather than a generated title
card, and the video closes on a 15-second generated disclosure card. Existing
configs that use the single `brand.cards` switch continue to get both cards.

### S2 - Real-capture-only episode

Given any Gate 1 manifest, when preflight runs before narration, then every
visual segment resolves to a declared prebaked clip. Missing clips are blocking
findings, no authenticated profile is required, and no mock or generated
product output can silently replace a real capture.

### S3 - Three distribution-ready cuts

Given the three selected cut configs, when each is loaded, then it resolves to a
1080 by 1920 canvas with a 1920 by 1080 capture viewport and a hard 60 second
ceiling. Each cut is self-contained, has at least 20 seconds of estimated
narration, leaves real-voice timing headroom below the ceiling, and carries its
own hook and payoff.

### S4 - Pinned channel identity and disclosure

Given any Gate 1 config, when narration and styling are resolved, then Dan's
approved cloned voice, model, seed, stability, similarity, copper accent, and
channel palette are explicit rather than inherited from mutable defaults.
Publishing copy and the master end card carry the approved AI-production
disclosure.

### S5 - Reproducible operator handoff

Given a new operator with the repository and the real captures, when they follow
the runbook, then they can place clips, run preflight, rehearse without TTS
spend, render with real narration, validate receipts and duration, complete the
versioned twelve-point checklist with end-to-end playback evidence, and roll
back by restoring the previous inputs and outputs. Publishing remains a
separate human action.

### S6 - Immutable production attempts

Given an operator supplies a new output directory for a rehearsal or
production attempt, when the CLI starts the pipeline, then it claims that
name atomically before reading inputs, binds later writes to a new private
directory handle on a Linux filesystem under Linux or WSL, retains the
authenticated claim as an output marker, publishes with a no-clobber rename,
and refuses an existing path without changing its artifacts. This protects
against accidental or cooperating path reuse; hostile same-UID processes are
outside the isolation boundary. Production renders
consume attempt-owned copies of every source clip. A reviewed four-output pack
is promoted only after every output and receipt pass validation.

## Constraints

- No credentials, browser profiles, source footage, rendered media, or publish
  state are committed.
- All product footage is a real operator capture. The pipeline may generate
  framing, captions, sound design, and the disclosure end card.
- Captures may be trimmed, reframed, labeled, and redacted for privacy.
  Product states, task results, and timestamps are never fabricated.
- Finished capture compositions use square sample pixels. Non-square SAR is
  rejected because the render filters operate on coded geometry.
- No new dependency or service.
- Existing demo configs retain their current card behavior.
- The approved Gate 1 factual claims and run-dependent receipt obligations are
  not broadened by this pack.
- Fresh-output and pack-promotion race checks assume cooperating processes.
  They must never delete or recursively mutate an unauthenticated replacement,
  but they do not claim isolation from a malicious process with the same Unix
  user identity.
- Repository source attestation covers committed application and launcher
  bytes plus the package and lock manifests. Installed dependency bytes,
  package-manager code, Node, ffmpeg, and other system tools remain separately
  reported toolchain inputs rather than repository source.

## Acceptance Criteria

- AC1: the brand config can independently disable the opening card and enable
  the closing card; the legacy `cards` value remains the default for both.
- AC2: the master config selects landscape output, a 600 second hard cap, no
  opening card, and a 15-second closing disclosure card. Its fake-TTS estimate,
  including that card, is at most 75 percent of the cap.
- AC3: exactly three cut configs select the shorts preset and a 60 second hard
  cap; their estimated narration windows are between 20 and 45 seconds.
- AC4: all four configs explicitly pin voice ID
  `AwstCxsCY8YE2KYw66By`, model `eleven_multilingual_v2`, seed 42,
  stability 0.5, and similarity 0.75.
- AC5: all manifest shots are prebaked, name unique clip inputs, parse through
  the production parser, and are left to preflight before TTS. Missing clips
  and full-bleed clips whose aspect differs from their output canvas or whose
  sample aspect ratio is non-square are blocking findings. Gate 1 configs may
  not consume an external music path that is absent from archived evidence.
- AC6: the production pack contains no banned Unicode dash characters and the
  approved disclosure is present in publishing copy.
- AC7: the operator runbook and receipt template cover rollout, monitoring,
  validation, rollback, all twelve channel checks, full final-mix playback,
  cue-by-cue voice review, final-render-derived chapter timing with every
  chapter spanning at least 10 seconds, and the separation between render
  completion and public publishing. The pack stops at reviewed local evidence:
  it does not model served state, the three-video streak, or promotion
  authority. Those remain in the ratified channel format and operator state.
- AC8: `--out` overrides the config output only for that run, requires a fresh
  name, refuses an existing target before changing any artifact, keeps all
  render writes in a private handle-bound directory while that name is claimed,
  leaves pathnames untouched on claim initialization failure, retains the
  authenticated claim as an output marker, and publishes without clobbering a
  competing target under the cooperative-process boundary. `--clips-dir` and
  `--script` require absolute paths and select attempt-owned clip and narration
  sources for that run.
  Before narration spend, each prebaked clip is copied into a private read-only
  render binding; the renderer and report consume only those bound bytes, so an
  ordinary later export to the operator source path cannot change the artifact
  or its digest. The binding root is removed on success, ordinary failure,
  SIGINT, and SIGTERM. A cleanup failure preserves the primary pipeline error,
  blocks fresh-output publication, and reports both the retained binding root
  and the unpublished output stage when present. Dashboard-only renders create
  no private binding root. The CLI rejects unknown or duplicate options and
  extra config paths rather than silently falling back to reusable output.
- AC9: reviewed-pack promotion requires the exact archived Gate 1 support,
  config, script, clip, and renderer-output inventory; recomputes full config,
  script, claim-ledger, and ordered per-shot clip SHA-256 values; validates the
  exact relative concat selection, shot and card timelines against the same
  measured archived segment bytes, and derived chapters whose adjacent starts
  (or final start and master total) are at least 10 seconds apart; rejects
  placeholder review evidence; refuses cross-device or nested-mount mutation before
  sealing; and closes every regular file under one locale-independent read-only
  manifest. Promotion and receipt validation start in privileged Bash, fix
  system-tool lookup, and scrub caller shell, preload, Git, Node, and
  package-manager injection variables. The operator entrypoint clears
  dynamic-loader variables before Bash starts, admits only the fixed path and
  locale in the environment, and passes one already-canonical root-owned Node
  binary explicitly to promotion and both receipt-validation phases. Each
  entrypoint requires root-owned non-writable ancestry and binds the canonical
  file identity and digest across its functional Node probe before accepting
  its exit status. If
  promotion stops while the
  authenticated private pack is still writable, it is restored without
  clobbering the attempt path. Once sealing starts, failure retains and reports
  the exact authenticated private or reviewed path. Once final verification
  commits the reviewed state, a failed status write cannot reverse success or
  block the independent verifier. Every production report also carries the same
  local source-build attestation for the receipt's commit, scoped Git tree,
  package manifest, and dependency lock. The attested mode is valid only when a
  launcher streamed from that fixed commit creates a private detached
  no-checkout worktree with hooks disabled, materializes committed objects
  without checkout filters, directly verifies and freezes the scoped bytes
  before application modules load, and runs the snapshot CLI. The streamed
  shell starts in privileged mode before reading caller startup files, fixes
  system-tool lookup independently of caller `PATH`, and invokes a canonical
  root-owned Node file plus the explicit operator-selected package-manager file.
  Authority-sensitive Git
  calls ignore caller global and system configuration and disable
  repository-local hooks and filesystem monitors. Frozen dependency
  installation runs in a minimal environment that excludes render secrets,
  points user, global, and XDG package-manager configuration at private empty
  locations, disables lifecycle scripts and pnpm hook files, and uses an
  snapshot-private package store. Application execution changes to the detached
  snapshot and pins its `tsconfig.json`; only that execution receives the
  render secret. The admitted session is a module-local capability that cannot
  be structurally copied into another pipeline graph, and the pipeline verifies
  its own module path is in that snapshot before claiming output. Ordinary
  mutable-checkout execution cannot emit an accepted attestation; source drift
  after admission blocks the render receipt. An attested run also fails if its
  required report cannot be built or written, or if an otherwise successful
  run cannot remove its detached snapshot.
## Test Seams

The primary seam is the existing config and manifest interface:
`loadConfig`, `parseScript`, `captureViewport`, and the fake-TTS duration
estimator. One contract test crosses that seam for all four production inputs.

The independent-card behavior is exercised at the config schema seam. The
pipeline consumes the resolved booleans and does not expose a second card-policy
interface.

Fresh attempt ownership is exercised at the CLI parser and pipeline entry
seams, before script parsing, preflight, narration, or rendering.

Receipt promotion is exercised at the shell validator seam with valid,
input-bound, incomplete, failed-item, missing-item, source-mismatch, and
same-geometry clip-substitution, claim-ledger substitution, external-input,
off-root concat-selection, placeholder, hostile startup-environment,
interruption-recovery, cross-filesystem, topology, and post-promotion mutation
cases. Source-build tests exercise
committed-launcher enforcement, private detached-snapshot admission, direct
Git-object byte and mode verification, dirty and untracked source rejection,
exact runner binding, caller shell-startup, function, `PATH`, Git-environment,
global Git-config execution, working-directory, and `tsconfig` rejection,
caller pnpm-config isolation, render-secret exclusion during dependency
installation, structural session forgery rejection, commit recomputation, and
post-render drift.

## Verification

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `FAKE_TTS=1 pnpm demo <config>` after all declared real captures are present
