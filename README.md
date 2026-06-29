# agent-demo-video

Turn a `DEMO_SCRIPT.md` and a running web app into a finished, narrated, captioned MP4 (≤5 min) — fully automated and headless.

## Install

```bash
npm install -g agent-demo-video      # or: npx agent-demo-video <config.json>
npx playwright install chromium      # one-time: capture browser
# ffmpeg + ffprobe must be on PATH (e.g. `apt install ffmpeg` / `brew install ffmpeg`)
```

Then `demo-video <config.json>` to render, or `demo-video login <config.json>` to log in
for an auth-walled `target: live` demo (see [Authenticated SaaS capture](#authenticated-saas-capture-target-live)).
An ElevenLabs API key enables real narration; `FAKE_TTS=1` runs keyless.

## What it does

The pipeline is **audio-first**: narration is synthesised first (via ElevenLabs `with-timestamps`), and the resulting audio duration — including exact per-character timing — becomes the clock that paces both the browser recording and the caption file. Because video dwell time is derived from the narration audio rather than estimated independently, audio, video, and captions are in sync by construction with zero drift.

Runs keyless with `FAKE_TTS=1`: the TTS step is replaced by a silent audio file of estimated duration so you can iterate on the script and action sequence without spending API quota.

## How it works

```
DEMO_SCRIPT.md
      │
      ▼
1. parseScript       — parse shots + actions from Markdown
2. TTS (ElevenLabs)  — synthShot per shot → audio + per-char alignment
3. Playwright capture— captureShot per shot: headless Chromium recordVideo,
                       injected fake cursor/overlays, dwell = narration duration
4. ffmpeg normalize  — re-encode each WebM segment to uniform MP4 (res/fps)
5. build timeline    — measure probe durations → assemble startSec offsets
6. captions.srt      — per-char alignment → word-timed SRT
7. pad audio         — silence-pad each audio track to match video segment
8. concat + mux      — concat video, concat audio, mux together
9. burn captions     — subtitles filter burned into final.mp4
10. parity verify    — shotCount / videoSegments / audioSec / videoSec / maxSec
```

Third-party / auth-walled surfaces have two options: drive them **live** behind a real login with `target: live` (a saved Playwright profile — see [Authenticated SaaS capture](#authenticated-saas-capture-target-live)), or, for surfaces you cannot or prefer not to automate, `target: prebaked`: supply a pre-captured clip file and the pipeline splices it in at the right point.

## Quickstart

```bash
# One-time setup
pnpm install
pnpm exec playwright install chromium

# Keyless dry run (silent audio, estimated duration)
FAKE_TTS=1 pnpm demo demo.config.sample.json

# Real render (ElevenLabs narration, requires API key in Doppler)
doppler run -p claude-code-use -c prd -- pnpm demo <your-config.json>
```

Output lands in the directory set by `out` (default `out/`): `final.mp4`, `captions.srt`, plus intermediate `audio/`, `seg/`, `video.mp4`, `muxed.mp4`.

## DEMO_SCRIPT format

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
| `highlight` | `selector` | Injects a highlight overlay |
| `chapter` | `label` or `text` | Shows a chapter card overlay |
| `wait` | `ms` | Pauses for N milliseconds |

For `target: prebaked`, set `clip` to the path of an existing video file; no browser is launched for that shot.

## Authenticated SaaS capture (`target: live`)

`target: live` drives an authenticated SaaS app (Slack, Notion, Linear, Stripe, any
Google-SSO app) behind its real login — no hand-captured clip needed. A live shot uses
the **same action syntax as `dashboard`**; the only difference is it runs against a saved
browser profile.

It's a two-step flow:

```bash
# 1. One-time (or whenever the session expires) — log in interactively.
#    A real browser opens at config.capture.auth.loginUrl; log in (incl. MFA),
#    then press Enter in the terminal once you can see your workspace.
demo-video login your-config.json

# 2. Render — live shots drive the saved profile headlessly.
demo-video your-config.json
```

Configure the auth section in `demo.config.json`:

```jsonc
{
  "script": "DEMO.md",
  "dashboardBaseUrl": "http://localhost:3000",
  "capture": {
    "auth": {
      "loginUrl": "https://app.slack.com/",
      "loggedInSelector": "[data-qa=\"channel_sidebar\"]", // optional — see below
      "confirmMode": "operator"                              // operator | selector | auto
    }
  }
}
```

A live shot in the manifest:

```markdown
### SHOT workspace
- target: live
- narration: Here's the decision filed straight into our Slack canvas.
- action: goto url="https://app.slack.com/client/T123/C456"
- action: highlight selector="[data-qa=\"message_input\"]"
```

**Login detection.** The default `confirmMode: "operator"` treats *your Enter keypress*
as the authoritative "logged in" signal — robust for apps whose DOM we don't control, and
it absorbs MFA/SSO with no special handling. An optional `loggedInSelector` enables
`confirmMode: "selector"` / `"auto"` (wait for a stable element instead) for unattended
re-auth, and is also used as a **record-time expiry guard**: if the marker is missing when
a live shot runs, the render **fails closed** ("session expired, re-run `demo-video login`")
rather than silently recording the logged-out wall. A bare URL match is never used (it
false-positives on SSO redirects).

**Auth at rest (security).** The saved profile holds session cookies/tokens, so it lives
**outside the repo** by default — `~/.cache/agent-demo-video` (honors `XDG_CACHE_HOME`).
It is never committed; `.gitignore` also excludes `.auth/`, `*.playwright-profile/`, and
`storageState*.json` as belt-and-suspenders, and a test (`tests/security.test.ts`) asserts
no auth artifact ever reaches a tracked path.

## Config

Key fields in `demo.config.json` (full schema in `src/types.ts`):

| Field | Default | Notes |
|---|---|---|
| `script` | — | Path to DEMO_SCRIPT.md |
| `dashboardBaseUrl` | — | Base URL of the running app (e.g. `http://localhost:3000`) |
| `out` | `"out"` | Output directory |
| `resolution` | `1920×1080` | Capture resolution |
| `fps` | `30` | Frame rate |
| `voice.voiceId` | Rachel (ElevenLabs) | ElevenLabs voice ID |
| `voice.modelId` | `eleven_flash_v2_5` | ElevenLabs model |
| `voice.seed` | `42` | Seed for reproducible synthesis |
| `voice.stability` | `0.5` | Voice stability |
| `voice.similarity` | `0.75` | Voice similarity boost |
| `theme.captionFont` | `"Arial"` | ffmpeg subtitle font |
| `theme.captionSize` | `24` | Subtitle font size (pt) |
| `theme.cursor` | `true` | Show fake cursor overlay |
| `clipsDir` | `"clips/prebaked"` | Directory scanned for prebaked clips |

Sample: `demo.config.sample.json`.

## Third-party tabs

For surfaces you cannot or should not drive live (SaaS login walls, desktop apps, external products), pre-capture a clip once and reference it:

```json
### SHOT uipath-studio
- target: prebaked
- clip: clips/prebaked/uipath-studio.mp4
- narration: UiPath Studio opens the workflow we exported earlier.
```

Place the clip in `clipsDir`. The pipeline passes it through normalize/mux/caption without launching a browser.

## Replicability

Pin `voice.seed` in your config and lock your ffmpeg and Chromium versions to get byte-stable reruns from the same script. The only inputs that change between demo iterations are `DEMO_SCRIPT.md` and `demo.config.json`; everything else is deterministic given the same narration audio.

## License

MIT
