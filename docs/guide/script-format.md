# DEMO_SCRIPT format

The script is a Markdown file. Each shot is a `### SHOT <id>` heading followed by key-value lines and action lines.

```markdown
### SHOT intro
- target: dashboard
- url: /
- narration: Welcome to the dashboard. Here you can see all your active workflows at a glance.
- action: goto url="/"
- action: wait ms=500

### SHOT click-workflow
- target: dashboard
- url: /workflows
- narration: Click any workflow card to open it in the editor.
- action: goto url="/workflows"
- action: click selector=".workflow-card:first-child"
- action: highlight selector=".workflow-card:first-child"

### SHOT third-party
- target: prebaked
- clip: clips/prebaked/uipath-login.mp4
- narration: Here is the UiPath Studio interface we integrate with.
```

**Action kinds:**

| Kind | Required attrs | Notes |
|---|---|---|
| `goto` | `url` | Navigates; relative to `dashboardBaseUrl` |
| `click` | `selector` | Moves fake cursor then clicks |
| `type` | `selector`, `text` | Types character-by-character (60 ms delay) |
| `hover` | `selector` | Hovers (no fake cursor move) |
| `highlight` | `selector` | Injects a highlight overlay. The selector must match **exactly one** element |
| `chapter` | `label` or `text` | Shows a chapter card overlay |
| `wait` | `ms` | Pauses for N milliseconds |
| `scroll` | `selector` or `y` | Smoothly scrolls the element into view, or to a pixel offset |

For `target: prebaked`, set `clip` to the path of an existing video file; no browser is launched for that shot.

Back to the [README](../../README.md).
