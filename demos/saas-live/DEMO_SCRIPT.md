# Live SaaS — Demo Script (manifest)

Example of `target: live`: an authenticated walkthrough driven against a saved
browser profile. Run `demo-video login demos/saas-live/demo.config.json` once to
log in, then `demo-video demos/saas-live/demo.config.json` to render.

Selectors are illustrative — verify them against the live DOM before recording
(see the dashboard demo's selector-verification discipline).

### SHOT 01-open
- target: live
- narration: This is our workspace, exactly as the team sees it after logging in.
- action: goto url="https://app.example.com/home"
- action: highlight selector="[data-qa=\"workspace_shell\"]"
- action: wait ms=2500

### SHOT 02-action
- target: live
- narration: Filing a record takes one click, and it lands in the shared log immediately.
- action: click selector="#new-item"
- action: wait ms=2000
- action: highlight selector="#recent-list"
- action: wait ms=1500
