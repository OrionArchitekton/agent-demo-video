# agent-demo-video

Turn a `DEMO_SCRIPT.md` and a running web app into a finished, narrated, captioned MP4 — fully automated and headless. Length is capped by `maxDurationSec` (default 300).

## Install

```bash
npm install -g agent-demo-video      # or: npx agent-demo-video <config.json>
npx playwright install chromium      # one-time: capture browser
# ffmpeg + ffprobe must be on PATH (e.g. `apt install ffmpeg` / `brew install ffmpeg`)
```

Then `demo-video <config.json>` to render, or `demo-video login <config.json>` to log in
for an auth-walled `target: live` demo (see [Authenticated SaaS capture](#authenticated-saas-capture-target-live)).
An ElevenLabs API key is REQUIRED for narration: without one the run stops rather than producing a silent video. Set `FAKE_TTS=1` to deliberately render silent placeholder narration (full pipeline otherwise identical).

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
3. Playwright capture— captureShot per shot: headless Chromium screencast
                       (CDP JPEG frames + per-frame timestamps), native
                       animated cursor + action annotations + chapter cards,
                       zoom-on-action camera motion, dwell = narration duration
4. ffmpeg normalize  — encode frames straight to H.264 (per-frame durations
                       from capture timestamps), uniform res/fps, soft fade-in
                       between segments
5. build timeline    — measure probe durations → assemble startSec offsets
6. captions.srt      — per-char alignment → word-timed SRT
7. pad audio         — silence-pad each audio track to match video segment
8. concat + mux      — concat video, concat audio, mux together
9. burn captions     — subtitles filter burned into final.mp4
10. parity verify    — shotCount / videoSegments / audioSec / videoSec / maxSec
```

### Production polish

Renders are produced pieces by default: the capture floats as a rounded,
shadowed window on a gradient backdrop (`theme.frame`), a synthesized ambient
bed ducks under the narration with soft click ticks and boundary sweeps
(`audio.*`; `audio.musicPath` swaps in your own track, local renders only),
captions pop word-by-word in sync with speech (`theme.captions: "wordpop"`,
accent via `theme.captionAccent`), a living camera keeps a gentle base zoom and
travels between action targets (`motion.livingCamera`), and optional brand
cards open and close the video (`brand: { title, subtitle, url, accent }`).
Narration defaults to ElevenLabs' quality tier (`eleven_multilingual_v2`).
Every knob has a legacy off-switch. Requires ffmpeg >= 5.1 (amix normalize,
gradients, zoompan input-time are all in use).

### Capture engines

The default engine is **screencast**: CDP JPEG frames are captured with their
timestamps and assembled into H.264 directly, so text stays crisp (no VP8
intermediate) and the frame timeline is deterministic (each frame's display
time comes from its capture timestamp, which keeps narration and captions in
sync by construction). It also enables the native liveliness features:

- **Animated cursor + action annotations** (`theme.annotations`, on by
  default): a pointer travels from action to action, interacted elements are
  visibly annotated, and `chapter` actions render as centered title cards.
- **Zoom-on-action** (`motion.zoomOnAction`, on by default): the camera eases
  toward each clicked/typed/highlighted element and back out, driven by the
  interaction event timeline persisted as `events_<shot>.json`.
- **Soft transitions** (`theme.fadeInMs`, default 250): each segment after the
  first opens with a brief fade-in instead of a hard cut.
- **Smooth scrolling**: `action: scroll selector="#target"` (or `y=800`)
  glides instead of jumping.

Set `capture.engine: "recordvideo"` to fall back to the legacy Playwright
recordVideo path (VP8 WebM intermediate, injected overlay cursor). A
screencast failure is an error, never a silent engine fallback.

A hermetic end-to-end check lives at `demos/smoke/` (a local `file://` fixture
page): `FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json`.

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
| `highlight` | `selector` | Injects a highlight overlay. The selector must match **exactly one** element |
| `chapter` | `label` or `text` | Shows a chapter card overlay |
| `wait` | `ms` | Pauses for N milliseconds |

For `target: prebaked`, set `clip` to the path of an existing video file; no browser is launched for that shot.

## Pre-flight selector gate

Before any narration is synthesized, the pipeline resolves every selector your script
declares against the page that shot opens at that point, and refuses to start when one of
them provably will not do what the script says.

```text
$ demo-video demo.config.json
  BLOCKING  shot "12-execution-boundary": selector "p" is ambiguous, 43 matches on http://localhost:3000/guide (the strict locator needs exactly one)
  BLOCKING  shot "05-plate": selector "[data-line='82']" matches nothing on http://localhost:3000/guide
  BLOCKING  shot "08-recap" uses 2 selector(s) but declares no goto action; capture builds a fresh context per shot, so this shot runs against about:blank and every locator waits out its full timeout
  INFO      shot "04-approve": selector ".verdict-box" matches nothing on http://localhost:3000/ (an earlier click or type in this shot can change the DOM, and the gate runs no actions, so this could not be verified)
✗ [agent-demo-video] preflight gate failed: 3 finding(s); no narration was synthesized.
```

It reports four things a script cannot tell you on its own:

- a selector that matches **nothing**, which the highlight overlay used to turn into a
  silent no-op;
- a selector that matches **more than one** element, because `document.querySelector`
  takes the first match, so a bare `p` or `code` selector looks correct while pointing
  somewhere else entirely;
- a shot that references a selector but **never navigates**. Capture builds a fresh
  browser context per shot, so such a shot runs against `about:blank` and every locator
  waits out its full timeout;
- a `prebaked` shot that declares selector actions, which capture never runs.

The gate resolves selectors with the same engine capture uses, against a page carrying
the same injected overlay, and waits for an element that hydrates in after load. Where it
resolves differently from the render it would be reporting on its own limitations, not on
your script.

It therefore only BLOCKS on a claim it can actually make. These are reported at `INFO` and
never fail a run:

- a selector that a preceding `click` or `type` in the same shot would have revealed (the
  gate runs no actions, so it cannot see that DOM);
- an ambiguous `hover`, because `page.hover` resolves non-strictly and renders fine;
- an auth-walled `live` shot, because the gate runs unauthenticated and would see the
  login wall;
- a page that did not settle before its selectors were counted.

`out/render-report.json` records whether the gate ran, whether it was declined, and which
shots it could not adjudicate, so a finished video says for itself how it was checked.

The gate is fail-closed. Set `preflight: false` in the config, or pass `--no-preflight`
for a single run, to decline it; a declined run says so in its output.

For a production attempt, pass `--out <new-directory>`. This per-run override
atomically reserves the fresh output name and refuses an existing path before
reading the script or changing an artifact. On a Linux filesystem under Linux
or WSL (not a mounted Windows/DrvFs path), later writes stay bound to a new
private staging-directory handle while the requested name remains occupied.
A changed claim fails the run without deleting the replacement; success parks
and retains the authenticated claim as `.agent-demo-video-output-claim` inside
the output, then publishes the staged directory with a no-clobber rename. This
protects against existing targets and accidental or cooperating concurrent
reuse. It is not an isolation boundary against a malicious process running as
the same Unix user, which can manipulate that user's pathnames and `/proc`
handles.
Omitting the flag preserves the legacy reusable `config.out` behavior. Use
distinct fresh directories for rehearsal and real narration.
`--clips-dir <absolute-directory>` can pin a run to attempt-owned copies of
prebaked inputs without changing the config file. Passing it also binds every
prebaked `clip:` strictly beneath that directory for the run: each `clip:`
must be a clean relative path (no absolute paths, no `.` or `..` components),
a path carrying its own directory resolves beneath the override directory
rather than the config directory, and each source is opened through
symlink-refusing directory handles (Linux only; the run fails closed
elsewhere). The config-relative resolution table under
[Third-party tabs](#third-party-tabs) does not apply to a
`--clips-dir` run, so the attempt-owned layout must mirror each `clip:`'s
relative path beneath the override directory. `--script <absolute-file>`
does the same for a copied narration manifest. Both overrides require absolute
paths so their meaning never changes with the launch or config directory.

Every successful `render-report.json` keeps the existing short config and
script hashes and also records full SHA-256 values for the resolved config,
script, and each ordered prebaked clip. Before narration spend, the pipeline
copies each source clip into a private read-only render binding. The renderer
and report consume only those bound bytes, so an ordinary later export to the
operator source path cannot change the artifact or its digest.

For a local source-run production render, `--attest-source-build` is reserved
for the committed snapshot launcher. The launcher bytes are streamed from one
fixed commit, create a private detached worktree, verify and freeze every
scoped repository byte before application modules load, and then invoke that
snapshot's `src/cli.ts`. Direct mutable-checkout use is refused. The report
records snapshot execution, the commit, scoped Git tree, package manifest, and
dependency-lock hashes, and the pipeline blocks the receipt if that state
changes during rendering. Installed dependency and system-tool bytes remain
reported toolchain inputs, not part of the repository source claim. The frozen
dependency install receives no render secrets and ignores caller npm/pnpm
configuration, lifecycle scripts, and pnpm hook files. Snapshot attestation is
intentionally incompatible with `--render-host` until remote bundles have their
own content-addressed attestation.

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
| `script` | — | Path to DEMO_SCRIPT.md. `--script <absolute-file>` overrides it for one run |
| `dashboardBaseUrl` | — | Base URL of the running app (e.g. `http://localhost:3000`) |
| `out` | `"out"` | Output directory. On a Linux filesystem under Linux or WSL, `--out <new-directory>` overrides it for one run, reserves a nonexistent target, renders through a private directory handle, retains the authenticated claim marker, and publishes with a no-clobber rename. This is a cooperative-process guarantee, not hostile same-UID isolation |
| `platform` | `"landscape"` | Distribution preset. `"shorts"` renders a 9:16 `1080x1920` canvas for Shorts/TikTok/Reels while still capturing at a 16:9 desktop viewport; the framed scene floats the capture as a window on the tall canvas. Explicit `resolution` / `capture.viewport` override the preset |
| `resolution` | preset (`1920×1080` landscape) | Output canvas of the finished video |
| `capture.viewport` | preset (follows canvas on landscape; `1920×1080` on shorts) | Browser capture geometry, decoupled from the canvas |
| `fps` | `30` | Frame rate |
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
| `brand` | (off) | `{ title, subtitle, url, accent, cards }` adds branded title and end cards. `titleCard` / `endCard` may override either side independently while `cards` remains the shared default |
| `clipsDir` | `"clips/prebaked"` | Where a **bare** prebaked clip filename resolves. Resolved against the config file's directory unless absolute; `--clips-dir <absolute-directory>` overrides it for one run and additionally binds every relative `clip:` strictly beneath that directory |
| `preflight` | `true` | Fail-closed pre-flight selector gate; see [Pre-flight selector gate](#pre-flight-selector-gate). `false` (or `--no-preflight`) declines it |
| `maxDurationSec` | `300` | Hard ceiling for the finished video. The render fails if the result exceeds it. Set it to the length limit you are shipping against. |
| `capture.settleMs` | `500` | Budget for the post-navigation readiness wait (fonts ready, visible images decoded). `0` disables the probe. Exceeding the budget warns and records anyway. Under the default `screencast` engine the wait happens BEFORE recording starts, so unsettled frames are excluded; the legacy `recordvideo` engine binds capture at context creation, so there the wait shifts those frames later rather than excluding them. |

Sample: `demo.config.sample.json`.

An executable real-production example lives at
[`demos/factory-ai-at-work/gate-01/`](demos/factory-ai-at-work/gate-01/README.md):
one landscape master and three portrait cuts, all pinned and fail-closed on
operator-supplied captures.

## Third-party tabs

For surfaces you cannot or should not drive live (SaaS login walls, desktop apps, external products), pre-capture a clip once and reference it:

```json
### SHOT uipath-studio
- target: prebaked
- clip: clips/prebaked/uipath-studio.mp4
- narration: UiPath Studio opens the workflow we exported earlier.
```

Clip paths resolve independently of the working directory you run from:

| `clip:` value | Resolves to |
|---|---|
| `uipath-studio.mp4` (bare filename) | `<config dir>/<clipsDir>/uipath-studio.mp4` |
| `clips/prebaked/uipath-studio.mp4` (carries a directory) | `<config dir>/clips/prebaked/uipath-studio.mp4` |
| `/srv/clips/uipath-studio.mp4` (absolute) | used exactly as given |

Place the clip in `clipsDir` and reference it by bare filename, or give a path relative to
your config file. Either way the pipeline passes it through normalize/mux/caption without
launching a browser. A clip that is not present at the resolved path fails immediately,
naming the path that was tried.

This table describes a run without `--clips-dir`. When `--clips-dir` is passed,
every `clip:` must be a clean relative path and resolves strictly beneath the
override directory instead; absolute clip paths and `.` or `..` components are
rejected, and symlinked ancestors or entries refuse to bind.

Add `- fullBleed: true` to a shot whose clip is ALREADY a finished composition, such as a
motion-graphic title card rendered by another tool. The pipeline then skips the window framing and
the segment fade-in for that shot, because the clip carries its own framing and its own motion.
Without it a full-bleed card is shrunk to `theme.frame.scale` inside a shadowed window it was never
designed for. A finished composition must match the output canvas aspect. Preflight probes existing
full-bleed clips before TTS, and the renderer checks again before normalization; a mismatch is
rejected instead of silently padded with bars. Finished compositions must use square sample pixels
(`1:1` SAR). The guard rejects anamorphic input because the current render filters operate on coded
geometry, and normalization pins the same `v:0` stream that the geometry probe validates.

```markdown
### SHOT title
- target: prebaked
- clip: clips/prebaked/title-card.mp4
- fullBleed: true
- narration: A safe harness is defined by what it refuses.
```

`fullBleed` accepts `true`/`false`, `yes`/`no`, or `1`/`0`, case-insensitively. An
unrecognised value is an ERROR, not a silently ignored line: a dropped flag would mean you believe
you opted out of framing while the pipeline frames anyway.

Author the clip to the length of its narration. Segment duration is `max(clipSec, narrationSec)`, so
a clip shorter than its narration is padded by freezing the last frame, never trimmed.

## Replicability

Pin `voice.seed` in your config and lock your ffmpeg and Chromium versions to get byte-stable reruns from the same script. The only inputs that change between demo iterations are `DEMO_SCRIPT.md` and `demo.config.json`; everything else is deterministic given the same narration audio.

## License

MIT
