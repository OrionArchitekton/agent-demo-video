---
name: demo-video
description: Use when the user wants a narrated, captioned demo video of a web app, a product walkthrough recording, or a launch or hackathon demo MP4, made headlessly from a script and a running app.
---

# Demo video with agent-demo-video

agent-demo-video turns a `DEMO_SCRIPT.md` and a running web app into a narrated, captioned MP4.
Narration is generated first and paces the recording and the captions, so all three stay in sync.
Everything runs headless from a config file.

## Prerequisites

Check these before the first render and tell the user what is missing:

- Node 18 or newer (`node --version`). Motion cards need Node 22.12 or newer.
- ffmpeg and ffprobe on `PATH` (`ffmpeg -version`).
- The capture browser, installed once: `npx playwright install chromium`.
- The app to record is running and reachable, or is a local folder of HTML files.

Run the CLI pinned to this plugin's version, from the directory that holds the config:

```bash
npx -y agent-demo-video@0.3.0 demo.config.json
```

## Workflow

Follow this order. Each step is cheap compared with the one after it.

1. **Write the script and config.** Read the app first (routes, the elements the demo will touch)
   and pick stable selectors: ids, `data-testid` attributes, labels. Keep each shot's narration to
   one or two plain sentences; the narration length sets the shot length.
2. **Preflight.** Every render starts with a fail-closed selector gate: each action's selector must
   match on the live app before anything is generated. `click`, `type`, `scroll` and `highlight`
   selectors must match exactly one element; `hover` may match several. Shots with `target: live`
   are not probed; the report lists them under `preflight.unverifiedShotIds`. If the silent pass
   stops here, fix the selectors it names. Never pass `--no-preflight` to get past a failure.
3. **Silent pass.** `FAKE_TTS=1 npx -y agent-demo-video@0.3.0 demo.config.json` renders the whole
   video with silent narration of estimated length. It costs nothing. The estimate runs short (real
   narration has run 19 to 30% longer), so keep the silent pass under about 75% of `maxDurationSec`.
4. **Review.** Extract the first frame
   (`ffmpeg -y -i out/final.mp4 -frames:v 1 out/frame0.png`) and dispatch the
   `agent-demo-video:render-reviewer` agent from this plugin with `out/contact-sheet.png`,
   `out/frame0.png`, `out/render-report.json` (it maps contact-sheet tiles to shots), the script and
   a one-line brief. Fix every BLOCKING flag and repeat the silent pass before going on.
5. **Narrated render.** Run again without `FAKE_TTS`, with the voice the user chose (below).
6. **Read the report.** Open `out/render-report.json`. Check `transcriptCheck` (always present;
   when it ran, it lists the phrases the narration did not say, and `ran: false` carries a reason
   when no aligner ran), `hook`, that `ttsMode` is `real` and not `fake`, and
   `preflight.unverifiedShotIds`. A failed deliverable check stops the run before the report is
   written. Look at `out/contact-sheet.png` once more, then give the user the path to
   `out/final.mp4`.

## Script format

Each shot is a `### SHOT <id>` heading followed by key-value lines and actions:

```markdown
### SHOT intro
- target: dashboard
- narration: This is the dashboard. Every active workflow, at a glance.
- action: goto url="/"
- action: highlight selector="#workflows"
- action: wait ms=800

### SHOT open-workflow
- target: dashboard
- narration: Click a workflow to open it in the editor.
- action: goto url="/"
- action: click selector="[data-testid=workflow-card-1]"
- action: wait ms=1200
```

Each shot starts in a fresh browser, so every dashboard shot needs its own `goto` first.

Actions: `goto url`, `click selector`, `type selector text`, `hover selector`,
`highlight selector`, `scroll selector` (or `scroll y`, a pixel offset), `chapter label`, `wait ms`. `goto` URLs are relative to
`dashboardBaseUrl`. Full reference:
https://github.com/OrionArchitekton/agent-demo-video/blob/master/docs/guide/script-format.md

## Config

```json
{
  "script": "./DEMO_SCRIPT.md",
  "dashboardBaseUrl": "http://localhost:3000",
  "out": "out",
  "brand": { "title": "My App", "subtitle": "What it does, in one line", "url": "myapp.example" }
}
```

Options worth knowing:

- `"platform": "shorts"` renders a 9:16 video. Give Shorts a `brand.hook` (1 to 60 characters): it
  is large text on the first frame.
- `maxDurationSec` (default 300) fails the render if the video runs longer.
- `brand.motion: true` animates the title and end cards. It needs Node 22.12 or newer and
  HyperFrames installed alongside the CLI, for example
  `npx -y -p agent-demo-video@0.3.0 -p hyperframes@0.8.155 demo-video demo.config.json`.
- Shots behind a login use `target: live` and need `capture.auth.loginUrl` (and usually
  `capture.auth.loggedInSelector`) in the config. The default login mode waits for a person to
  press Enter, so the user runs `npx -y agent-demo-video@0.3.0 login demo.config.json` in their
  own terminal, not Claude.

Full reference:
https://github.com/OrionArchitekton/agent-demo-video/blob/master/docs/guide/config.md

## Voice

Ask the user which voice to use before the narrated render:

- **ElevenLabs.** Set `ELEVENLABS_API_KEY` in the environment. Without a key the run stops rather
  than shipping a silent video. Never write the key into a file or print it.
- **Their own text-to-speech.** Any program they can run from a shell:

  ```json
  "voice": {
    "provider": "command",
    "command": ["my-tts", "--text-file", "{text}", "--out", "{out}"]
  }
  ```

  `{text}` is a file holding the shot's narration and `{out}` is where the program writes audio.
  Add an `aligner` for word-timed captions and the transcript check:
  https://github.com/OrionArchitekton/agent-demo-video/blob/master/docs/guide/voice.md
- **Silent.** `FAKE_TTS=1`, for drafts only.

## Rules

- Never commit or print API keys or login profiles. The login profile lives outside the project.
- Fix a failing selector; never skip the preflight gate.
- Do not run the narrated render until the reviewer's BLOCKING flags are fixed.
