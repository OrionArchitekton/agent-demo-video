# agent-demo-video

Optional prepared opening scenes and external scene renderers are documented in
[Optional opening scene](docs/guide/optional-intro.md). They are off by default,
preserve narration and timing, and require no Blender or private scene library.

Turn a `DEMO_SCRIPT.md` and a running web app into a finished, narrated, captioned MP4, headless and
repeatable. Narration is generated first and becomes the clock for the screen recording and the
captions, so audio, video and captions stay in sync by construction. Length is capped by
`maxDurationSec` (default 300).

[![The self-demo: agent-demo-video rendering a video of itself](docs/media/self-demo-poster.jpg)](https://youtu.be/9Oi9SKoahvs)

Watch the self-demo on YouTube (one minute): the tool rendered it of a sample app and of its own
script, run and checks, from [`demos/self/`](demos/self/README.md). The video file is also on the
[v0.3.0 release](https://github.com/OrionArchitekton/agent-demo-video/releases/download/v0.3.0/agent-demo-video-self-demo.mp4).

## Install

All three ways need Node 18 or newer and ffmpeg 5.1 or newer plus ffprobe on `PATH`
(`apt install ffmpeg` or `brew install ffmpeg`; check with `ffmpeg -version`).

**Claude Code plugin.** Adds a `demo-video` skill that walks Claude through a video, and a
read-only `render-reviewer` agent that checks the contact sheet before narration is spent:

```text
/plugin marketplace add OrionArchitekton/agent-demo-video
/plugin install agent-demo-video@agent-demo-video
```

Then ask Claude for a demo video of your app. The skill runs the CLI through `npx`.

**npx or a global install:**

```bash
npx -y -p agent-demo-video@0.3.0 playwright install chromium   # one time: the browser build this CLI uses
npx -y agent-demo-video@0.3.0 demo.config.json
# or: npm install -g agent-demo-video, then: demo-video demo.config.json
```

**From source:**

```bash
git clone https://github.com/OrionArchitekton/agent-demo-video.git
cd agent-demo-video
pnpm install
pnpm exec playwright install chromium
```

## Quickstart

From a source checkout, render the bundled smoke demo with silent narration. It needs no API key
and no running app:

```bash
FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json
```

Output lands in `demos/smoke/out/`: `final.mp4`, `captions.srt`, `contact-sheet.png` and
`render-report.json`.

For your own app:

1. Write a `DEMO_SCRIPT.md`: one `### SHOT <id>` per shot, with narration and browser actions
   ([script format](docs/guide/script-format.md)).
2. Write a `demo.config.json` that points at the script and your running app
   ([config](docs/guide/config.md); sample: [`demo.config.sample.json`](demo.config.sample.json)).
3. Render with `FAKE_TTS=1` first and look at `contact-sheet.png`.
4. Choose a voice and render for real.

```markdown
### SHOT intro
- target: dashboard
- narration: This is the dashboard. Every active workflow, at a glance.
- action: goto url="/"
- action: highlight selector="#workflows"
- action: wait ms=800
```

## Examples

With the Claude Code plugin installed, ask in plain language:

1. "Make a 60-second narrated demo video of my app at http://localhost:3000 covering signup and the dashboard."
2. "Do a silent draft pass of demos/smoke/demo.config.json and have the render-reviewer check the contact sheet before we pay for narration."
3. "Render a 9:16 Shorts version of this demo with a hook on the first frame."
4. "My app is behind a login. Set up a saved browser profile and record the settings page."

## Voice

- **ElevenLabs.** Set `ELEVENLABS_API_KEY`. Without a key the run stops rather than shipping a
  silent video.
- **Your own text-to-speech.** `voice.provider: "command"` runs any program you can call from a
  shell, with an optional aligner for word-timed captions ([voice](docs/guide/voice.md)).
- **Silent.** `FAKE_TTS=1` renders placeholder narration of estimated length, for drafts.

## Features

- **Screencast capture** with an animated cursor, highlights, chapter cards, zoom on action, a
  slowly drifting camera, a framed scene and light sound design
  ([how the pipeline works](docs/guide/pipeline.md)).
- **Fail-closed preflight.** Selectors are checked against the running app before any narration is
  generated. Shots behind a login, and selectors that follow a click or type in the same shot, are
  reported rather than proven ([preflight](docs/guide/preflight.md)).
- **Apps behind a login.** `target: live` drives a saved browser profile kept outside the repo;
  `demo-video login <config.json>` creates it ([authenticated capture](docs/guide/authenticated-capture.md)).
- **Prebaked clips and third-party tabs** for surfaces you cannot or prefer not to automate
  ([third-party tabs](docs/guide/third-party-tabs.md)).
- **Shorts.** `"platform": "shorts"` renders 9:16, and `brand.hook` puts large text on the first
  frame ([config](docs/guide/config.md)).
- **Quality checks.** When `voice.aligner` is configured, a transcript check compares what the
  video says with the script, and Shorts without a hook are flagged ([quality checks](docs/guide/quality-checks.md)).
- **Motion cards.** `brand.motion: true` animates the title and end cards with HyperFrames, an
  optional add-on ([motion cards](docs/guide/motion-cards.md)).
- **Verified output.** Every render probes the delivered `final.mp4` against the configured
  format, writes a `contact-sheet.png` with one still per segment (title and end cards included), and records everything in
  `render-report.json`.

## CLI

```text
demo-video <config.json> [--no-preflight] [--out <new-directory>] [--script <absolute-file>]
                         [--clips-dir <absolute-directory>] [--render-host <host>]
demo-video login <config.json>
```

## Documentation

- [How the pipeline works](docs/guide/pipeline.md)
- [Script format](docs/guide/script-format.md)
- [Config](docs/guide/config.md)
- [Preflight selector gate](docs/guide/preflight.md)
- [Authenticated capture](docs/guide/authenticated-capture.md)
- [Third-party tabs](docs/guide/third-party-tabs.md)
- [Voice](docs/guide/voice.md)
- [Quality checks](docs/guide/quality-checks.md)
- [Motion cards](docs/guide/motion-cards.md)
- [Changelog](CHANGELOG.md)

## Replicability

Pin `voice.seed` in your config and lock your ffmpeg and Chromium versions to get byte-stable
reruns from the same script. The only inputs that change between demo iterations are
`DEMO_SCRIPT.md` and `demo.config.json`; everything else is deterministic given the same narration
audio.

## Data and network

agent-demo-video runs on your machine and has no telemetry. These are all the network calls it
makes, and the one credential it reads:

| When | Endpoint | What is sent |
|---|---|---|
| Narration with ElevenLabs (the default voice), unless `FAKE_TTS=1` | `https://api.elevenlabs.io/v1/text-to-speech/<voiceId>/with-timestamps` | Each shot's narration text and the configured voice settings, authenticated with `ELEVENLABS_API_KEY` in the `xi-api-key` header. Without the key the run stops before any request. |
| The plugin's skill, or `npx agent-demo-video@0.3.0` | npm registry (`registry.npmjs.org`) | A normal package download of the pinned version. |
| `playwright install chromium`, run once | Playwright's browser download hosts | A normal download of the Chromium build Playwright pins. |
| Recording | The app URLs in your `demo.config.json` | The browser loads your own app (usually `localhost`) and any third-party tabs you configure, as a normal browser would. |
| `--render-host <host>` only | The host you name, over your own `ssh` and `rsync` | The staged render directory, so that host can render it. |
| `voice.provider: "command"` or `voice.aligner` only | Whatever your command contacts | Your own program runs; the bundled `tools/align_whisper.py` downloads its Whisper model from Hugging Face on first use. |

`ELEVENLABS_API_KEY` is the only credential the tool reads, and it is sent only to ElevenLabs.
Optional HyperFrames motion cards run with HyperFrames' telemetry, update check and self-install
turned off.

Everything else stays local. Saved login profiles for `target: live` (cookies and session
storage) live outside the repo, under `~/.cache/agent-demo-video` by default, and are never
uploaded. Renders, captions, contact sheets and reports are written to your output directory;
the only time they leave your machine is a `--render-host` render, to the host you name.

## License

MIT
