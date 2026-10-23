---
title: Diagnose backward command word timings
verified: 2026-10-23
review_after: 2027-01-23
topics: [command-provider, captions, word-timings]
references:
  - src/command-voice.ts
  - src/command-voice.test.ts
  - src/tts.test.ts
  - tests/fixtures/voice/regressive-words.sh
  - docs/guide/voice.md
---

# Backward word timings

A `word timings regress at index N` failure identifies the command voice or
aligner and the supplied timing file. The index starts at zero. Inspect that
word and the previous word: both start and end timestamps must be nondecreasing
in the spoken word order. Ordered overlaps and equal timestamps remain valid.

Correct the timestamp producer while keeping the spoken word sequence. Do not
sort words by timestamp to conceal bad output. Malformed provider timings stop
before the configured aligner; malformed aligner timings stop before estimated
captions. Missing timings retain the documented fallback behavior.

Validate locally with `pnpm exec vitest run src/command-voice.test.ts
src/tts.test.ts`, then `pnpm typecheck` and `pnpm build`. For the normal demo
workflow, invoke `pnpm demo` with the command-provider fixture and confirm a
backward timing file stops before final media is produced. Run the ordered
overlap control with the same configuration and confirm it reaches its normal
render result. Silent synthetic fixtures establish pipeline behavior only.

After an approved merge and rebuild, monitor the first command-provider demo
for this diagnostic and validate its provider output. If valid ordered timings
are rejected, retain the input and log, prepare a scoped revert, and rebuild
after approval. No schedule, GPU model, provider credentials or publishing
state needs to change to diagnose this contract.
