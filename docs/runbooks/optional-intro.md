---
verified: 2026-10-25
review_after: 2026-11-25
topics: [demo-video, optional-intro, remote-render, look-check]
references:
  - specs/optional-intro-spec.md
  - src/optional-intro.ts
  - src/look-check.ts
  - src/manifest.ts
  - src/render.ts
  - src/ffmpeg.ts
  - src/command-voice.ts
  - docs/guide/optional-intro.md
---

# Optional intro operations

Keep the feature off by default. Install optional external programs separately;
the package installs and renders without them. See the [interface and receipt
guide](../guide/optional-intro.md) before opting in. No service, timer, upload or
paid compute is part of this workflow.

## Private rehearsal and rollout

1. Retain a real sample-app capture and its narration. Render an ordinary
   control into a new output directory, preserving its hashes and diagnostics.
2. Disable the title card, choose a 3-4 second interval beginning at source zero,
   and inspect 4-8 scene stills with the actual UI before rendering motion.
   Check legibility, highlight glare, hook placement and the front-on match cut.
3. Render one candidate and a missing-renderer fallback into distinct fresh
   outputs. Exercise both landscape and portrait geometry with small fixtures.
   The first complete candidate may be landscape. Never replace a completed
   control or candidate to repair an optional look.
4. Decode the delivered MP4. Compare shot count, frame rate, measured timeline,
   narration and caption timing with the control. Inspect frame zero and both
   sides of the cut. Inspect the final contact sheet and audio playback.
5. Read `optionalIntro` and `lookCheck` in `render-report.json`. Verify the asset
   identity against its receipt. Record complete-film, intro and body metrics,
   including failures. Preserve technical diagnostics even when the look fails.
6. Extract a requested thumbnail candidate from a reviewed still and use the
   existing editable-title workflow. Accept the video and thumbnail separately.
   Fixture renders establish integration; they cannot accept a creative scene.

For the first three opted-in private demos retain controls, hashes, review
stills/contact sheets, per-window metrics, fallback reasons and elapsed wall
time. Feature activation is per config. Source merge, package release and
public media release each follow their existing separate approval.

## Failure diagnosis

`title_card_enabled` and `source_too_short` mean the scene tool was skipped.
`missing_renderer` means no asset or command was selected.
`renderer_unavailable`, `renderer_timeout` and `invalid_candidate` select the
original first shot. `source_too_large` skips sources over 512 MiB;
`asset_too_large` rejects or cancels an oversized candidate. Copy/hash loops
check the preparation deadline. These limits do not sandbox operator programs.
Read the retained receipt/request and candidate under
`optional-intro/attempt-*`; do not reuse an earlier successful command output.

Transport, staged hash/path, main-render, source-attestation and output-ownership
errors remain fatal. Reconcile those errors before starting another attempt.
Source mutations during preparation remain fatal even if the scene command
fails. Duration and identity are measured from the same private source snapshot;
the original is checked against that identity before acceptance. Metadata probes
retain at most 1 MiB of combined output and omit unrelated candidate tags.
Staged symbolic links are rejected, and the encoder consumes the verified
open file and checks the actual encoded input stream's checksum. The optional
input uses ffmpeg's standard `cache` and `pipe` protocols;
check `ffmpeg -protocols` if a custom ffmpeg build rejects that input.
There is no automatic renderer or main-render retry. Preparation is local; any
future remote adapter needs explicit deadline and cancellation receipts before
its retries can be admitted. Never terminate shared GPU work to make room.

Checker absence or incomplete metrics is `unavailable`; a measured threshold or
checker-verdict failure is `fail`. Both are advisory. Do not lower the motion
profile floors or treat a passing intro as complete-film acceptance.
The checker reads a separate snapshot under its attempt directory. A modified
snapshot invalidates its metrics. A modified or missing delivered MP4 is fatal;
the output checksum and format are checked after analysis.
`checker_output_limit` means the window exceeded 1 MiB of combined stdout/stderr.
Only its owned process group is stopped; its metrics are unavailable and its
retained log and later log reads stay bounded. Quiet the checker before another
operator-invoked attempt.

## Validation and rollback

Run `pnpm test`, `pnpm typecheck` and `pnpm build`. The intro integration tests
exercise actual MP4 substitution, localhost remote parity, staging tampering,
legacy fallbacks, deadlines and existing-output preservation. Inspect a package
tarball to confirm no scene media, Blender, private tool or operator config ships.

Rollback removes `optionalIntro` and optionally `lookCheck` from the config,
then rebuilds from preserved capture/narration into another fresh directory.
Keep failed attempts and their reasons for diagnosis. Source rollback uses a
reviewed revert; no runtime migration or cleanup is required.
