# Remote render offload - spec

## Summary

Add the ability to run the demo-video **render stage** (the CPU-bound ffmpeg
assembly: normalize, concat, mux, caption burn-in) on a **remote render host**
reached over SSH, instead of on the local workstation. This first slice is a
**standalone, generic proof**: it does not modify the existing capture/render
pipeline (`src/pipeline.ts`) and does not change default behavior. The render
host is a runtime parameter (any `user@host`, including `localhost`); nothing in
the code is specific to any one machine or network.

Motivation: the render stage is pure CPU (libx264 + libass) and is cleanly
separable from the Playwright capture stage (which needs a browser and the
running web app and must stay local). Offloading it frees a busy workstation.

## Domain language (one canonical term per concept)

- **Render stage**: the ffmpeg assembly steps that turn captured segments +
  narration + caption alignment into `final.mp4`. (synonym replaced: "ffmpeg
  half", "assembly")
- **Render host**: the machine that executes the render stage. `localhost` means
  the local machine (still exercised through the same manifest + bundle path).
- **Render manifest**: a single serialized description of everything the render
  stage needs (input file paths, the caption **alignment** serialized to SRT,
  and `{resolution, fps, theme}`), so the stage can run on another machine.
- **Render bundle**: the render-stage code bundled to one self-contained ESM
  file so it runs on a host that has `node` + `ffmpeg` but not this repo's
  toolchain (e.g. no pnpm).

## Constraints

- **Generic, no topology in code.** Host/user/paths are parameters. No hardcoded
  hostnames, IPs, or estate-specific values in the repo.
- **Parity by reuse.** The render bundle is built from the existing
  `src/ffmpeg.ts` + `src/captions.ts`, not a reimplementation, so a remote render
  runs the identical ffmpeg command sequence.
- **Mechanism: SSH + rsync only.** No task queue, Redis, or Docker context: the
  render is a single synchronous job per invocation. (An external benchmark
  confirmed a queue is unwarranted at this scale.)
- **Headless + reproducible** (repo AGENTS.md): no interactive prompts; the whole
  run is driven by the manifest + explicit host argument.
- **No new runtime dependencies.** rsync/ssh are invoked as external commands;
  the bundler (tsup/esbuild) is already a dev dependency.
- **Caption font parity.** `theme.captionFont` for a remote render must be pinned
  to a face installed on both hosts (default the runner to **Liberation Sans**, a
  metric-compatible Arial substitute) so libass does not silently substitute and
  diverge from a local render.
- **Non-destructive fallback.** A remote failure must never mutate or delete the
  local inputs; a local render remains available as the fallback.

## Scenarios / acceptance criteria

1. **Produces a video remotely.** Given valid render inputs and a reachable
   render host with `node` + `ffmpeg` (libx264 + libass), when the remote-render
   runner runs, then a `final.mp4` is produced on the local machine.

2. **Output parity (the proof).** Given the same inputs, when the video is
   rendered locally and via the render host, then the two outputs are
   **equivalent** by the equivalence bar:
   - **Structural (ffprobe):** identical duration (within +/- 1 frame),
     resolution, fps, video codec, audio codec, and stream count.
   - **Visual:** for N (default 3) evenly sampled timestamps, the decoded frame
     from each output has SSIM >= 0.98 (catches caption/font drift, which
     structural checks miss).

3. **Loud, safe failure.** Given an unreachable or failing render host, when the
   runner runs, then it exits non-zero with a clear diagnostic naming the failed
   step (rsync-up / ssh-render / rsync-down), and the local inputs are unchanged
   (verified by content hash before/after).

4. **Manifest round-trips.** Given in-memory render inputs (including the caption
   alignment that today is never written to disk), when serialized to a manifest
   and read back, then the SRT and config reproduce exactly what an in-process
   render would use.

## Test seams (fewest, highest; chosen deliberately)

- **Seam 1 - manifest serialization (unit, vitest).** Pure function
  `buildManifest(inputs) -> {srt, config, files}` and its inverse read. No I/O,
  no host. Exercises scenario 4. Fast, hermetic.
- **Seam 2 - render parity (integration, vitest).** Drive a tiny 1-2 shot fixture
  through both a local in-process render and the remote-render runner pointed at
  **`localhost`**, then assert the equivalence bar (scenario 2) and the
  non-destructive property (scenario 3, by pointing at an unreachable host).
  Using `localhost` keeps the automated suite **hermetic** - it still exercises
  the full manifest -> (rsync/ssh to localhost or a local adapter) -> bundle
  render -> ffprobe/SSIM path, with no dependency on any private infrastructure.

**Estate proof (out-of-repo ops step, not a repo test):** the estate validates
the same runner pointed at `hermes-01` and records the parity result. hermes is
never referenced in the repo or its tests.

## Out of scope for this slice (follow-ups)

- Wiring remote render into `src/pipeline.ts` behind a `--render-host` flag
  (the "integrated" option) - a separate change once this proof holds.
- Publishing this to the public OSS repo - an explicit operator gate; this slice
  lands on a branch and is proven locally + against hermes, not pushed public
  without approval.
- Parallel/queued multi-render, GPU/NVENC encode, or non-SSH transports.
