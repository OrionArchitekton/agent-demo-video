# Factory AI at Work: Gate 1

This is the executable production pack for:

`How to Use Claude Cowork on Windows (Step-by-Step Tutorial)`

It contains one landscape master and three portrait cuts selected in the
approved episode script. The configs pin Dan's approved cloned voice and the
channel palette. The manifests use only operator-supplied prebaked footage
because Windows setup dialogs, Claude Desktop, File Explorer, a physical
laptop, and a phone cannot be reproduced honestly by the headless Linux
capture path.

## Current state

The production inputs are versioned. The real captures are not present and are
intentionally ignored by Git. Preflight therefore blocks before narration
spend until every file in `CAPTURE_PLAN.md` has been placed under `clips/`.
Existing clips also fail preflight if their display aspect does not match the
declared landscape or portrait canvas, or if they use non-square sample pixels;
`fullBleed` never hides letterboxing or anamorphic distortion.

This pack does not publish anything, store an authenticated browser profile,
or claim that Gate 1 has passed. A successful render is an input to the channel
QA gate, not a publish decision.

The production runbook copies the exact configs, scripts, and capture inputs
into the fresh attempt and renders through per-run `--script` and `--clips-dir`
overrides. A reviewed attempt therefore owns the source bytes it hashes and
does not drift when the next correction replaces pack-local files. Real renders
also use the committed source-snapshot launcher. It streams launcher bytes from
one fixed commit, verifies and freezes a private detached worktree before
application modules load, and binds all four reports to that snapshot commit
and dependency lock. Direct mutable-checkout attestation is rejected.

## Layout

- `master/`: one landscape episode, capped at 600 seconds.
- `cuts/cut-a/`: the two Windows setup traps.
- `cuts/cut-b/`: the real file organization job.
- `cuts/cut-c/`: where Cowork sessions and local files run.
- `CAPTURE_PLAN.md`: exact footage contract and run-dependent receipts.
- `CLAIM_LEDGER.md`: current primary-source mapping and drift disposition.
- `PUBLISHING.md`: title, chapters, description, and cut captions.
- `PRODUCTION_RECEIPT_TEMPLATE.md`: versioned review evidence and the exact
  twelve-point channel checklist.
- `docs/runbooks/factory-ai-at-work-gate-01-production.md`: render and rollback
  procedure.

## Commands

From the repository root:

```bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm test -- tests/factory-ai-at-work-pack.test.ts

FACTORY_REHEARSAL_ROOT="out/factory-ai-at-work/gate-01/attempts/$(date -u +%Y%m%dT%H%M%SZ)-rehearsal"
mkdir -p "$(dirname "$FACTORY_REHEARSAL_ROOT")"
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

Use the runbook for the real-voice render and QA sequence. Do not pass
`--no-preflight` for a production render. Every rehearsal and real render uses
a new, exclusively claimed output root; never rerun into a reviewed directory.
The claim protects against accidental or cooperating reuse, not a hostile
process running under the same Unix user.

## Known production boundary

The approved source carries per-block delivery cues. The current pipeline pins
one voice parameter set for the whole render, so those cues remain human
listening criteria rather than a machine-enforced config field. The production
receipt requires an end-to-end final-mix playback and a disposition for every
block. If the clone delivers a block flat, adjust the spoken punctuation or
split and review the voice take; do not silently rotate voices or models.

The claim ledger was refreshed against live Anthropic documentation on
2026-07-30. That refresh narrowed the approval narration to the documented
Manual, Auto, and Skip modes; the older blanket promise that Cowork always asks
no longer ships.

The three configs render one platform-neutral tail that is used unchanged on
Shorts, TikTok, and Reels. Platform packaging must not replace the reviewed
bytes. Public upload remains a separate operator action.
