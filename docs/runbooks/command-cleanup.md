---
title: Diagnose command-provider helper cleanup
verified: 2026-10-21
review_after: 2027-01-21
topics: [command-provider, process-lifecycle, cleanup]
references:
  - src/command-voice.ts
  - src/command-voice.test.ts
  - docs/guide/voice.md
---

# Command-provider cleanup

Each invocation has a temporary Node supervisor owning its POSIX process group.
The provider runs in that group. The supervisor reports the provider's result,
allows 250 ms for final helper output, then kills its own group while its identity
is still live. The caller sends cleanup requests over the supervisor's owned IPC
channel and never signals a numeric child PID or retired group ID. A closed
channel never falls back to PID signalling. The supervisor is embedded in the
CLI; deployment requires the normal build, with no separate install or service.

After adopting a revision, run a local command-provider demo whose provider
deliberately leaves a same-group helper. Check the helper's running state after
both success and failure, the resulting MP4 on success, and the original error
diagnostic on failure. Keep an independently owned process alive as a control.
On Linux, a terminated zombie is different from a running helper; record which
condition was observed rather than inferring it from signal zero alone.

For manual cancellation, interrupt the CLI normally with SIGINT or SIGTERM.
The CLI asks each live supervisor to retire its group. Avoid independently
SIGKILLing the supervisor: forced external termination can prevent it from
cleaning its members. Parent IPC disconnection also triggers group cleanup.

A cleanup warning means a signal or cleanup request failed. The original command result
remains intact. Providers own the retirement of helpers whose credentials they
change or which they move into another process group/session. Group signalling
does not certify that privileged or escaped processes have stopped.

Monitor command completion and process retirement together. Expected overhead
is roughly 250 ms per invocation for the final drain. If regressions appear,
preserve command logs and process-state evidence, prepare a scoped revert through
the reviewed PR workflow, and rebuild after merge approval. Do not compensate
with host-wide process killing or change an unrelated inference owner's runtime.
