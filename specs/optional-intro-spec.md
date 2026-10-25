# Optional demo intro and advisory look review

An operator may replace the opening three to four seconds of the first captured
shot with a prepared scene showing that same screen interval. The choice is off
by default. Blender and external scene tools are optional, separately installed
programs; the public package requires no private repository.

## Scenarios and acceptance criteria

1. **Ordinary demo.** With no optional intro, capture, narration, rendering and
   the measured timeline retain established behavior. No scene tool runs.
2. **Prepared opening.** With the title card disabled and a sufficiently long
   first capture, validate a prepared clip and its receipt, snapshot the clip,
   and substitute exactly the selected opening interval. A receipt binds the
   source SHA-256, interval starting at zero, output SHA-256, canvas, frame rate,
   and recipe identity. This records renderer/operator attestation; it cannot
   establish visual authenticity by itself. Captions and narration remain above
   the scene and retain their original timeline and segment count.
3. **Optional preparation failure.** A missing tool or invalid candidate leaves
   the original first shot in use and records the reason. An enabled title card
   or short first capture bypasses preparation entirely. Every external tool
   has a bounded deadline (intro default 1800 seconds, range 1 to 3600), followed
   by up to five seconds of graceful owned-process cleanup. Copying and hashing
   check that deadline. Optional sources and candidates are limited to 512 MiB;
   oversized candidates cancel the attempt and sources above that limit skip
   the scene. These acceptance limits do not sandbox operator programs.
   No retries occur.
   Remote preparation adapters are outside this first public slice; operators
   must supply a locally prepared asset. No implicit SSH or credential transfer.
4. **Portable, verified input.** Local and remote rendering consume the same
   snapshot with byte length, SHA-256 and recipe identity. Missing, changed or
   escaping staged input is fatal. Source-attestation, output ownership,
   transport, aspect, duration and main-render failures remain fatal and never
   initiate a fallback render. Opted-in pipeline attempts require fresh outputs.
5. **Advisory look review.** After final encoding and existing diagnostics,
   optionally invoke an operator-selected checker on the complete film, intro
   and remaining demonstration. Record motion-profile floors of 30 percent
   motion, 100 contrast and 50 brightness. Unavailable/malformed checker output
   is unavailable; a nonzero verdict is failure. Neither changes technical
   acceptance or publishes anything. Missing tools never fabricate a pass.
   The checker receives a separate copy; altered analysis input cannot supply
   passing metrics. Changes to the actual delivered video remain fatal.
6. **Thumbnail candidate.** Thumbnail art remains a separate, operator-run
   workflow using reviewed scene stills and the existing editable-title image
   workflow. Ordinary video rendering emits no thumbnail and invokes no image
   generator. Motion thresholds do not apply to stills.

## Test seams and delivery

Use the existing pipeline/render-input/report seam, including its manifest and
localhost transport, for behavioral verification. Decode a real rendered MP4
for frame-zero, transition, geometry, caption and audio checks. Process timeout
fixtures exercise the existing owned command runner. Package inspection verifies
that private tools, media and operator config are absent.

The first public slice accepts prepared assets and a local command adapter.
Shared laptop presets and surrounding plates remain separate consumer/tool work.
Retain a private control, candidate, missing-tool fallback, contact sheets,
per-window metrics and hashes. Creative acceptance of a real 3D scene and its
thumbnail belongs to the operator; a synthetic fixture proves rendering only.
No merge, release, upload, paid compute or scheduled work is implied.
