# Factory AI at Work Gate 1 Production Receipt

Copy this template to the fresh production attempt as
`PRODUCTION_RECEIPT.md`. The committed template is a blank form, not evidence
that a render, review, channel check, or publication happened.

Replace every placeholder token before reviewed-artifact promotion. Local
promotion requires the exact render handoff status below. It does not
authorize upload or establish a channel gate pass.

## Receipt identity

- Run ID: PENDING
- Source commit SHA: PENDING
- Attempt root: PENDING
- Reviewed root: PENDING
- Capture inventory reference: PENDING
- Claim ledger SHA-256: PENDING
- Claim source refresh date: PENDING
- Reviewer: PENDING
- Review start UTC: PENDING
- Review stop UTC: PENDING
- Total Dan review minutes: PENDING
- Review decision and rationale: PENDING
- Render handoff status: PENDING
- Dan publication approval: NOT_REQUESTED
- Channel gate status: NOT_EVALUATED

Allowed render handoff statuses are `REVIEWED_FOR_PUBLISH_HANDOFF` and
`REJECTED`. Only `REVIEWED_FOR_PUBLISH_HANDOFF` is eligible for local
promotion. The publication and channel fields above remain exactly
`NOT_REQUESTED` and `NOT_EVALUATED` in this immutable pre-upload receipt.
`Source commit SHA` is copied from
`master/render-report.json.sourceBuildAttestation.commit`; all four reports
must carry the same detached-commit-snapshot source-build attestation for that
commit.
Publication remains a separate operator action. Current served state and the
three-episode counter belong only to the ratified channel operator authority,
not this pre-upload receipt.

## Artifact evidence

Record measurements and SHA-256 values from the files in this attempt.

| Artifact | Final SHA-256 | Report SHA-256 | Duration | Geometry and SAR | Video and audio present | TTS real | Voice and model pinned | Parity | Preflight |
|---|---|---|---|---|---|---|---|---|---|
| master | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| cut-a | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| cut-b | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| cut-c | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |

Use `1920x1080, SAR 1:1` or `1080x1920, SAR 1:1` for geometry. The five
binary evidence cells must be exactly `PASS`, `REAL`, `PINNED`, `PASS`, and
`ENFORCED`, respectively.

- Input and output hash manifest: `PRODUCTION_RECEIPT.sha256`
- Toolchain versions: PENDING
- YouTube chapters SHA-256: PENDING

## Run-dependent evidence

- R1 source folder count and non-sensitive inventory: PENDING
- R2 exact Cowork prompt and task receipt: PENDING
- R3 permission mode, whether a prompt appeared, and matching footage: PENDING
- R4 before and after inventory plus formula-cell spot checks: PENDING
- R5 task and lid-close continuation timestamps: PENDING
- R6 same-session desktop, web, phone, and notification evidence: PENDING
- R7 scheduled-task history, on-demand run, and output artifact: PENDING
- R8 rights-clean shot and music inventory for every clip: PENDING

## Full final-mix playback and voice delivery

Play every final mix from frame 1 through the final frame. Record start and
stop timestamps, then disposition every narration block against its delivery
cue. First-and-last-sentence sampling is not sufficient.

| Artifact or block | Playback or cue evidence | Issues and disposition |
|---|---|---|
| master full mix, start UTC and stop UTC | PENDING | PENDING |
| 01-cold-open | PENDING | PENDING |
| 02-roadmap | PENDING | PENDING |
| 03-setup | PENDING | PENDING |
| 04-install-it-right | PENDING | PENDING |
| 05-first-real-task | PENDING | PENDING |
| 06-where-it-runs | PENDING | PENDING |
| 07-anywhere-on-a-schedule | PENDING | PENDING |
| 08-recap | PENDING | PENDING |
| 09-next | PENDING | PENDING |
| cut-a full mix and hook, start UTC and stop UTC | PENDING | PENDING |
| cut-b full mix and hook, start UTC and stop UTC | PENDING | PENDING |
| cut-c full mix and hook, start UTC and stop UTC | PENDING | PENDING |

## Twelve-point channel checklist

All twelve disposition lines must be exactly `PASS` before render handoff.
Record concrete evidence, not an unsupported check mark. A local pass does not
establish the separate post-upload channel gate outcome.

### 1. Review economics

- Disposition: PENDING
- Requirement: Dan completed the end-to-end watch, spot checks, and review in
  30 minutes or less, with start and stop timestamps.
- Operator evidence: PENDING

### 2. Claims

- Disposition: PENDING
- Requirement: Every technical claim has a primary-source claim-ledger entry
  or an executed-run receipt; there are no unsupported statistics, "most
  people" assertions, or unshown capability claims.
- Operator evidence: PENDING

### 3. Real captures

- Disposition: PENDING
- Requirement: Every screen recording is a real capture of a real run; no
  mocked, staged, or generated output is presented as real.
- Operator evidence: PENDING

### 4. Rights

- Disposition: PENDING
- Requirement: Footage, music, fonts, and other media are owned or licensed,
  with the rights inventory attached.
- Operator evidence: PENDING

### 5. Dash-clean packaging

- Disposition: PENDING
- Requirement: The automated scan found zero U+2013, U+2014, or U+2015
  characters in title, description, chapters, thumbnail text, SRT, ASS, pinned
  comment, and end-card text.
- Operator evidence: PENDING

### 6. Title and thumbnail

- Disposition: PENDING
- Requirement: The title uses an allowed structure, its demand source is
  logged, and the thumbnail passes the 168 px legibility and channel rules.
- Operator evidence: PENDING

### 7. Captions

- Disposition: PENDING
- Requirement: Captions use at most 42 characters per line, at most 2 lines,
  and at most 21 characters per second; copper emphasis renders correctly;
  open, middle, and close timing checks pass; all text stays in safe areas.
- Operator evidence: PENDING

### 8. Audio

- Disposition: PENDING
- Requirement: Narration is present on all four final mixes; end-to-end
  playback found consistent levels and no silence, duplication, clipping, flat
  delivery, dead air, or abrupt cuts.
- Operator evidence: PENDING

### 9. Visual integrity

- Disposition: PENDING
- Requirement: End-to-end playback found no frozen or all-white segments;
  chapters align with block boundaries; the end card holds for 15 seconds with
  the disclosure.
- Operator evidence: PENDING

### 10. Disclosure

- Disposition: PENDING
- Requirement: The About page was checked current; the description contains
  the correct per-video disclosure and voice sentence; the planned answer and
  rationale for each target platform AI-content field is recorded before
  upload.
- Operator evidence: PENDING
- Planned platform AI-content answers and rationale: PENDING

### 11. Vertical cuts

- Disposition: PENDING
- Requirement: Three 1080x1920 cuts are 60 seconds or less, playable end to
  end, caption-safe, and each has its own hook.
- Operator evidence: PENDING

### 12. Provenance

- Disposition: PENDING
- Requirement: Final render reports, pinned voice parameters, toolchain
  versions, claim ledger, review timestamps, disclosure plans, input clips, and
  hashes are archived so the shipped render is reproducible from the current
  script.
- Operator evidence: PENDING

## Gate protocol

- This receipt proves reviewed local evidence only. It does not record served
  state or change the channel counter.
- The ratified Factory AI at Work format and current operator state are the
  sole authority for the three consecutive episode passes that unlock promotion
  and hub linking. Portrait cuts do not count as separate episodes.
- Any post-publish miss makes the affected episode private and is recorded as
  an escaped defect and counter reset in that operator authority.
