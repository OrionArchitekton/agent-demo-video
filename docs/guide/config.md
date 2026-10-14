# Config

Key fields in `demo.config.json` (full schema in [`src/types.ts`](../../src/types.ts)):

| Field | Default | Notes |
|---|---|---|
| `script` | (none) | Path to DEMO_SCRIPT.md. `--script <absolute-file>` overrides it for one run |
| `dashboardBaseUrl` | (none) | Base URL of the running app (e.g. `http://localhost:3000`) |
| `out` | `"out"` | Output directory. On a Linux filesystem under Linux or WSL, `--out <new-directory>` overrides it for one run, reserves a nonexistent target, renders through a private directory handle, retains the authenticated claim marker, and publishes with a no-clobber rename. This is a cooperative-process guarantee, not hostile same-UID isolation |
| `platform` | `"landscape"` | Distribution preset. `"shorts"` renders a 9:16 `1080x1920` canvas for Shorts/TikTok/Reels while still capturing at a 16:9 desktop viewport; the framed scene floats the capture as a window on the tall canvas. Explicit `resolution` / `capture.viewport` override the preset |
| `resolution` | preset (`1920×1080` landscape) | Output canvas of the finished video |
| `capture.viewport` | preset (follows canvas on landscape; `1920×1080` on shorts) | Browser capture geometry, decoupled from the canvas |
| `capture.auth` | (none) | Login for `target: live` shots: `loginUrl` and `loggedInSelector` (required unless `allowUnguardedLiveCapture` is set); see [Authenticated SaaS capture](authenticated-capture.md) |
| `fps` | `30` | Frame rate |
| `voice.provider` | ElevenLabs | `"command"` runs your own TTS command; see [Use your own voice](voice.md) |
| `voice.voiceId` | Rachel (ElevenLabs) | ElevenLabs voice ID |
| `voice.modelId` | `eleven_multilingual_v2` | ElevenLabs model (`eleven_flash_v2_5` stays selectable for cheap drafts) |
| `voice.seed` | `42` | Seed for reproducible synthesis |
| `voice.stability` | `0.5` | Voice stability |
| `voice.similarity` | `0.75` | Voice similarity boost |
| `theme.captionFont` | `"Arial"` | ffmpeg subtitle font |
| `theme.captionSize` | `24` | Subtitle font size (pt) |
| `theme.cursor` | `true` | Show fake cursor overlay |
| `theme.captions` | `"wordpop"` | Word-pop ASS captions synced to TTS alignment; `"block"` restores the legacy SRT burn |
| `theme.frame.enabled` | `true` | Scene framing: the capture floats as a rounded, shadowed window on a gradient backdrop |
| `audio.soundDesign` | `true` | Synthesized ambient bed ducked under narration, click ticks, segment sweeps |
| `motion.livingCamera` | `true` | Continuous camera path with drift; `motion.zoomOnAction: false` disables all camera motion |
| `brand` | (off) | `{ title, subtitle, url, accent, hook, cards, motion }` adds branded title and end cards. `hook` (1 to 60 characters) is large text on the title card's first frame; see [Quality checks](quality-checks.md). `titleCard` / `endCard` may override either side independently while `cards` remains the shared default. `motion: true` renders the cards as animated HTML; see [Motion cards](motion-cards.md) |
| `clipsDir` | `"clips/prebaked"` | Where a **bare** prebaked clip filename resolves. Resolved against the config file's directory unless absolute; `--clips-dir <absolute-directory>` overrides it for one run and additionally binds every relative `clip:` strictly beneath that directory |
| `preflight` | `true` | Fail-closed pre-flight selector gate; see [Pre-flight selector gate](preflight.md). `false` (or `--no-preflight`) declines it |
| `maxDurationSec` | `300` | Hard ceiling for the finished video. The render fails if the result exceeds it. Set it to the length limit you are shipping against. |
| `capture.settleMs` | `500` | Budget for the post-navigation readiness wait (fonts ready, visible images decoded). `0` disables the probe. Exceeding the budget warns and records anyway. Under the default `screencast` engine the wait happens BEFORE recording starts, so unsettled frames are excluded; the legacy `recordvideo` engine binds capture at context creation, so there the wait shifts those frames later rather than excluding them. |

Sample: [`demo.config.sample.json`](../../demo.config.sample.json).

An executable real-production example lives at
[`demos/factory-ai-at-work/gate-01/`](../../demos/factory-ai-at-work/gate-01/README.md):
one landscape master and three portrait cuts, all pinned and fail-closed on
operator-supplied captures.

Back to the [README](../../README.md).
