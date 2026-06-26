# Proctor — Demo Script (manifest)

Dashboard-only walkthrough of the Proctor regression-testing loop, captured
against the live Next.js app running keyless on :3000 (PROCTOR_FAKE_LLM=1).

Selectors verified against the live DOM:
- `button.btn-secondary` — Bootstrap / Re-learn (unique)
- `button.btn-primary`   — Run change (unique)
- `.toggle-btn >> nth=1` — the "degraded" model toggle
- `button.btn-pass`      — ✓ Approve (only present when an approval task is open)
- highlight uses CSS querySelector: `.card` (contract), `.run-controls`, `.feed`, `.verdict-box`

### SHOT 01-intro
- target: dashboard
- narration: Proctor is an agent that QAs other agents — it catches when a model or prompt change silently breaks a non-deterministic AI automation.
- action: goto url="/"
- action: chapter label="Proctor — the agent that QAs other agents"
- action: wait ms=3000

### SHOT 02-learn
- target: dashboard
- narration: First, Proctor learns the automation's behavioral contract — per-field assertions at the right altitude, plus hard domain invariants for an invoice extractor.
- action: goto url="/"
- action: highlight selector=".card"
- action: click selector="button.btn-secondary"
- action: wait ms=8000
- action: highlight selector=".contract-meta"
- action: wait ms=1500

### SHOT 03-good-run
- target: dashboard
- narration: A clean change is re-evaluated against that contract. Invariants hold and semantics match, so Proctor passes it and reports green to the governance plane.
- action: goto url="/"
- action: highlight selector=".run-controls"
- action: click selector="button.btn-primary"
- action: wait ms=5000
- action: highlight selector=".feed"
- action: wait ms=1500

### SHOT 04-regression
- target: dashboard
- narration: A degraded model breaks the contract. Proctor calls it a real regression and pauses on a human-approval hook. The operator approves, and the loop closes.
- action: goto url="/"
- action: click selector=".toggle-btn >> nth=1"
- action: click selector="button.btn-primary"
- action: wait ms=7000
- action: highlight selector=".verdict-box"
- action: wait ms=2000
- action: click selector="button.btn-pass"
- action: wait ms=5000

### SHOT 05-close
- target: dashboard
- narration: Every layer — engine, durable workflows, dashboard, UiPath integration, and tests — was built entirely by Claude Code.
- action: goto url="/"
- action: chapter label="Built entirely by Claude Code"
- action: wait ms=4000
