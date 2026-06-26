# Agent-Driven Hackathon Demo-Video Pipeline — Architecture Decision

**Author:** lead architect synthesis | **Date:** 2026-06-26
**Goal:** fully-automated, coding-agent-driven pipeline producing a <=5-min hackathon demo video end-to-end ("100% built with coding agents"), replicable across hackathons as a repo + Claude Code skill.

---

## 1. TL;DR recommendation

**Build our own thin pipeline on Playwright + ElevenLabs + ffmpeg, orchestrated from a Claude Code skill — clone nothing, fork nothing.** No existing repo captures our actual surface (a Next.js dashboard *plus* real authenticated UiPath Automation Cloud tabs with synced narration + captions); the closest reference (Tamir Dresher's blog) films a CLI via a bespoke tunnel + non-headless OBS and won't transfer. Capture the dashboard walkthrough with Playwright `recordVideo` (CDP-level, headless==headed on our WSL2 chromium) driven by a deterministic hero-script with an injected fake cursor + overlays; capture the UiPath tabs as separate recorded pages in the same context (fallback: pre-captured fixed clips). Generate narration per shot via ElevenLabs `text-to-speech/.../with-timestamps` (audio + char-level alignment in one call, `seed` pinned for determinism), derive an SRT from the alignment, and let the **audio duration of each shot be the single source of truth** that paces both the browser actions and the captions. Stitch all segments + narration with **ffmpeg** (libx264 + libass burn-in) for v1; reserve **Remotion** as an optional polish layer for title cards/lower-thirds later. **Verdict: build-own** — the load-bearing pieces (Playwright MCP, chromium, ffmpeg, ElevenLabs key in Doppler) are already wired; the only new code is the glue, and owning it is the only way to hit deterministic + headless + parameterized-skill.

---

## 2. Landscape map

| Tool | Role | Linux-headless | Agent-scriptable | Cost | Verdict |
|---|---|---|---|---|---|
| **Playwright `recordVideo`** | Capture browser-app shots (dashboard + UiPath tabs) → WebM | ✓ (CDP-level, headless==headed) | ✓ | free | **ADOPT** — primary capture |
| **ElevenLabs `with-timestamps`** | Narration TTS + char-level alignment in one call | ✓ (HTTP) | ✓ | ~$0.05–0.10 / 1k chars (<$0.50 for 5 min) | **ADOPT** — narration + sync source |
| **ffmpeg + libass** | Concat, scale/pad, audio mux, caption burn-in, transcode | ✓ | ✓ | free (installed) | **ADOPT** — v1 compositor |
| **Injected fake cursor + overlays** (Abrahms/knightli/recast pattern) | Make headless capture read as a demo (cursor, click ripple, chapter cards) | ✓ | ✓ | free | **ADOPT** (borrow pattern, own the script) |
| **Remotion** (`renderMedia`) | Code-defined title cards / lower-thirds / timeline + local whisper captions | ✓ (auto chromium, bundles ffmpeg) | ✓ | free ≤3 employees; paid license above | **OPTIONAL polish** — phase 2 |
| **Xvfb + ffmpeg x11grab** | Virtual-display capture of native/multi-window content | ✓ (setup-heavy) | ✓ | free | **FALLBACK** — only if same-context Playwright can't reach UiPath |
| **ElevenLabs `forced-alignment`** | Align pre-recorded audio to transcript (per-word + confidence) | ✓ | ✓ | low | **FALLBACK** — if narration ever recorded outside API |
| Tamir Dresher pipeline (CLI Tunnel + OBS + frame-size heuristic) | End-to-end CLI demo video | ✗ (OBS/Clipchamp GUI) | partial | free | **BORROW IDEAS** (audio-sync math, Remotion idea) |
| kfallah/voice-demo-agent | Live Claude+Playwright-MCP voice puppeteer | ✓ | ✓ | API keys | **BORROW IDEAS** (no video output at all) |
| coder/agent-tty | Deterministic *terminal* WebM capture | ✓ | ✓ | free (Apache-2.0) | **BORROW IDEAS** (optional terminal B-roll only) |
| LiveKit agent-demos / Egress | Realtime WebRTC voice agents; Egress = room recorder | ✓ (heavy: SFU+Redis) | partial | infra | **AVOID** — wrong primitive, nondeterministic, no license |
| whisper.cpp (`@remotion/install-whisper-cpp`) | Local word-level captions | ✓ | ✓ | free (CPU/GPU) | **OPTIONAL** — only if not using ElevenLabs alignment |
| Demo SaaS (Arcade/Supademo/Guidde/Tella/Screen Studio) | Polished demo capture | ✗ (GUI/cloud) | ✗ | paid | **AVOID** — borrow UX ideas (auto-zoom, chaptering) only |

---

## 3. Recommended pipeline (end-to-end)

Input: `DEMO_SCRIPT.md` (timed shot list + narration). Output: one `<=5-min` MP4 + SRT sidecar.

1. **Parse `DEMO_SCRIPT.md` → manifest.** Agent emits an ordered JSON manifest: `[{ id, narration, actions[], target (dashboard|uipath|terminal), selectors/url }]`. This manifest is the single contract every stage reads.

2. **Pre-generate narration (TTS-first, then capture).** For each shot, `POST /v1/text-to-speech/{voice_id}/with-timestamps` with `output_format=mp3_44100_128`, a **pinned `seed` + fixed `voice_settings` + `model_id`** (use `eleven_flash_v2_5` for fast iteration, `eleven_multilingual_v2` for final). Save the audio **and** the `alignment` JSON (`characters[]` + `character_start/end_times_seconds[]`). **The measured audio length of each clip becomes that shot's authoritative duration.** This is deliberately done *before* capture so the browser knows how long to dwell on each beat.

3. **Build captions + duration manifest.** Collapse char-level alignment into word groups → write a global SRT/ASS. Compute each shot's cumulative start offset = sum of prior shot durations. Now both captions and browser pacing share one timeline.

4. **Capture the dashboard walkthrough (Playwright).** Drive the Next.js app (`Bootstrap → Run good → Run degraded → approve`) in a browser **context with `recordVideo`**, headless on WSL2 chromium. Inject a CSS-animated **fake cursor + `pointer-events:none` overlay layer** (cursor dot, click ripple, highlight box, chapter title card) via `page.evaluate` — headless chromium renders no real cursor, so this is mandatory for "looks like a demo." Use `pressSequentially` for typing and **`sleep(shotDuration)` from the manifest** so each beat lasts exactly its narration length. WebM is written on `context.close()` → transcode to H.264 per shot.

5. **Capture the UiPath Automation Cloud tabs.** Preferred: automate login once, then open the **Action Center task / Orchestrator job / queue** views as additional pages **in the same recorded context** (each becomes its own WebM — Playwright records one file per page). Pace each with its shot duration. Because UiPath is live third-party SaaS (least deterministic part), **fallback** = pre-capture those three views once into fixed clips and treat them as static segments. (Second fallback for any native/multi-window need: Xvfb + `ffmpeg x11grab` around a Playwright-driven chromium.)

6. **Normalize + stitch (ffmpeg).** Transcode all WebM → H.264 MP4 at a uniform **1080p / 30fps**, scale/pad to match. `ffmpeg concat` the segments in manifest order into one silent video whose segment boundaries equal the cumulative offsets from step 3.

7. **Mux narration.** `ffmpeg concat` the per-shot narration MP3s into one track (boundaries already aligned to video segments by construction), then mux over the silent video. Because audio drove the video dwell times, drift is structurally near-zero.

8. **Burn captions.** `ffmpeg -vf subtitles=captions.srt` (or `.ass` for styling) with `-c:v libx264 -crf 20 -c:a aac`. (Subtitle burn-in forces a re-encode — single pass, pick a fast preset for iteration.)

9. **Emit + verify.** Final `<=5-min` MP4 + SRT sidecar. Verify total runtime, segment count vs manifest, and audio/video length parity.

**Agent determinism:** every step is a CLI/Node/HTTP call with no human in the loop; pinned `seed` + fixed source commits + manifest-as-contract → same inputs produce the same video. Doppler injects `ELEVENLABS_API_KEY`.

---

## 3b. Sync strategy (the hard part)

**Decision: audio-duration-as-source-of-truth (TTS-first), not script-driven sleeps and not post-hoc alignment.** Two competing approaches and why we pick this one:

- **Script-driven sleeps (open-loop):** author guesses each beat's seconds, `sleep()` the browser to match. Simple but **drift accumulates** — if a UI action runs long/short vs its budget, audio and video diverge over a 5-min video. Rejected as the primary.
- **Audio-first (closed-loop) — CHOSEN:** generate ElevenLabs narration *first*, **measure each clip's real duration**, and feed that exact duration back as the browser's dwell time for that shot. The narration track and the video segments are cut on the *same* boundaries by construction, so they cannot drift — there is no reconciliation step, the timeline is shared.

**Mechanics:**
- Per-shot narration → `len(audio_i)` = shot duration `d_i`. Cumulative offset `o_i = Σ d_{<i}`.
- Browser dwells `d_i` on shot i (the `sleep`/`waitForTimeout` budget *is* the audio length).
- Captions: ElevenLabs char-level `character_start/end_times_seconds` collapsed to words → SRT cues, each shifted by `o_i`. Same timestamps that the audio obeys → captions are automatically in sync with narration.
- ffmpeg concat of audio and concat of video both honor `{d_i}` → audio segment N aligns to video segment N with no `adelay` math needed (simpler than Tamir's per-clip `adelay+amix`, which we only fall back to if shots overlap).

**Critical caveat (orchestrator owns this):** ElevenLabs times the *audio*, not the *UI*. If a UI action genuinely takes longer than its narration (e.g. a slow UiPath job load), **pad the shot**: extend the dwell and pad the narration clip with trailing silence to `max(action_time, audio_time)`, recompute `d_i`. Never let the action outrun its budget. This single rule (pad-to-max) keeps the closed loop honest when reality is slower than speech.

---

## 4. Reuse decisions (the 4 given sources)

- **Tamir Dresher blog → BORROW IDEAS.** Strong architecture, wrong capture surface. Take: (1) per-segment TTS synced to timestamped actions, (2) Remotion for title cards/lower-thirds as code. **Discard entirely:** CLI Tunnel, OBS/Clipchamp (non-headless — fatal on our WSL2 box), and the PNG-frame-size timestamp heuristic (tuned to a *clearing terminal*; useless on an always-full dashboard — we emit timestamps from the Playwright driver / ElevenLabs alignment instead). Swap Edge TTS → ElevenLabs. Port orchestration from Copilot CLI → Claude Code skill. Cite: https://www.tamirdresher.com/blog/2026/03/05/ai-produced-demo-video

- **kfallah/voice-demo-agent → BORROW IDEAS (do not base on it).** Confirms Claude + Playwright-MCP can drive our exact flow, and donates a small ElevenLabs MP3→ffmpeg→PCM snippet. But it **produces no video** (the one capability we need most), is interactive/mic-driven/non-deterministic, and has **no LICENSE (all-rights-reserved)** — cannot fork. Idea source only. Cite: https://github.com/kfallah/voice-demo-agent

- **coder/agent-tty → BORROW IDEAS.** Apache-2.0, deterministic, agent-skill-shaped — but **terminal-only**, can't film a browser. Two transferable assets: (1) its **record-event-log-then-deterministically-render** + stable `--json` CLI + bundled agent-skill packaging is exactly the *shape* our browser pipeline should take; (2) optional deterministic terminal **B-roll** (e.g. a "built 100% by agents" command montage, Doppler render) cut into the final edit. Not the core engine. Cite: https://github.com/coder/agent-tty

- **livekit-examples/agent-demos → AVOID.** Realtime WebRTC conversational agents = the inverse primitive of a deterministic scripted render. Recording needs a separate heavyweight stack (LiveKit server + Egress + Redis), reintroduces network/timing nondeterminism, and the repo has **no LICENSE**. Only takeaways (already covered without it): ElevenLabs is a fine TTS (we call it directly), and headless-chromium→MP4 compositing is sound (we get it from Playwright+ffmpeg). Cite: https://github.com/livekit-examples/agent-demos, https://docs.livekit.io/server/egress

---

## 5. Build plan

**Ship both: a standalone repo AND a thin Claude Code skill that invokes it.** The repo is the engine (replicable, testable, version-controlled); the skill is the agent-invocable entry point satisfying the "reusable as a Claude Code skill" requirement.

**Parameterized inputs (the skill's args / repo config):**
- `script` — path to `DEMO_SCRIPT.md` (the contract)
- `targets` — dashboard base URL + per-shot selectors; UiPath tab URLs (+ login strategy or path to pre-captured clips)
- `voice` — ElevenLabs `voice_id` + `model_id` + `seed` + `voice_settings`
- `theme` — overlay/caption style (cursor, chapter cards, font, colors), output `resolution`/`fps`

**Proposed repo layout (`agent-demo-video/`):**
```
demo.config.json            # the parameterized inputs above
src/
  parse-script.ts           # DEMO_SCRIPT.md -> manifest.json
  tts.ts                    # ElevenLabs with-timestamps -> audio/ + alignment/ + durations
  captions.ts               # alignment -> captions.srt/.ass
  capture-dashboard.ts      # Playwright hero-script: fake cursor + overlays + paced dwell -> webm
  capture-uipath.ts         # same-context recorded pages OR fixed-clip loader
  overlay.ts                # injected fake-cursor / click-ripple / chapter-card layer
  stitch.ts                 # ffmpeg normalize + concat + mux + burn-in -> final.mp4
  verify.ts                 # runtime/segment/parity assertions
remotion/                   # OPTIONAL phase-2 title cards / lower-thirds
clips/prebaked/             # optional pre-captured UiPath segments + terminal B-roll
out/                        # manifest.json, audio/, final.mp4, captions.srt
.claude/skill/SKILL.md      # the invocable skill wrapper (manifest in -> MP4 out)
```

**Replicability across hackathons:** the manifest is the only thing that changes per demo; `demo.config.json` swaps URLs/voice/theme. Pin chromium + ffmpeg + ElevenLabs `model_id`/`seed` so reruns are byte-stable for judges. Register the skill in the dan-skills router. Secrets stay in Doppler (`doppler run` injection), never on disk. Estate discipline: build in a fresh worktree off `main`, open a PR — do not work in a canonical home checkout.

---

## 6. Risks & gotchas (severity-graded)

**BLOCKING**
- **UiPath = live third-party SaaS, least deterministic surface.** Auth flow + nondeterministic SaaS UI can break a clean run. *Mitigation:* default to **pre-captured fixed clips** for the three UiPath views; only attempt live login-automation if time allows. This de-risks the single most fragile dependency.
- **Playwright records one WebM per page, headless renders no cursor, no audio, no settable fps.** *Mitigation:* fake-cursor/overlay layer is mandatory; transcode + concat downstream; accept fixed-ish quality (good enough for judges at 1080p30).

**WARNING**
- **Audio/video drift.** Mitigated structurally by the audio-first closed loop + pad-to-max rule (§3b); the failure mode is only if a UI action silently outruns its budget — assert action_time ≤ d_i in `verify.ts`.
- **ElevenLabs rate/cost.** Concurrency is tier-capped (Free 2 / Starter 3 / Creator 5 / Pro 10) — generate shots **sequentially** to avoid 429; cost is trivial (<$0.50 for a 5-min script). Per-request char limits → already chunked per shot.
- **`with-timestamps` is per-character, not per-word** → must group chars into words for readable cues (small, deterministic code). `eleven_v3` timestamp support is uncertain → **pin `multilingual_v2`/`flash_v2_5`** which are documented.
- **Remotion company license** kicks in above 3 employees — fine for hackathon/eval, flag before any commercial use. Keep Remotion **optional** so the v1 ffmpeg path has zero license exposure.

**INFO**
- **Smooth-cursor realism:** real `mouse.move` interpolation is janky (Playwright #5160); the reliable path is the CSS-animated injected cursor, not real mouse events.
- **WSL2 headless capture** is fine for Playwright `recordVideo` (CDP-level); only the Xvfb+x11grab *fallback* needs display-num/screen-size/window-placement care.
- **Caption burn-in re-encodes** (no `-c:v copy`) — single extra pass; pick CRF/preset for iteration speed.

**Time-to-build estimate:** MVP (dashboard-only, ffmpeg stitch, narration synced, no UiPath live) ≈ **0.5–1 day**. Full reusable tool (UiPath segments, captions burned, skill packaged, parameterized, verify gate) ≈ **2–3 days**. Optional Remotion polish ≈ **+1 day**.

---

## 7. Fastest path for TODAY (MVP) vs fuller tool later

**TODAY — get the Proctor video out (target: a few hours):**
1. Hand-write or agent-generate `manifest.json` from `DEMO_SCRIPT.md` (skip a fancy parser).
2. ElevenLabs `with-timestamps` per shot → save MP3 + alignment; measure durations. Pin `seed`, use `eleven_flash_v2_5`.
3. Playwright hero-script for the **dashboard only** (`Bootstrap → Run good → Run degraded → approve`) with the injected fake cursor + a minimal overlay, `recordVideo`, dwell = audio duration per shot.
4. **Pre-capture the 3 UiPath views once** as fixed clips (manual-ish login OK for the first cut — it's a one-time capture, the *pipeline* is what's automated). Drop into `clips/prebaked/`.
5. ffmpeg: normalize all → 1080p30, `concat` video, `concat` narration, mux, **burn SRT** from the char alignment. One `final.mp4`.
6. Eyeball sync, pad any shot where the UI lagged, re-run. Ship.

This already satisfies: deterministic, headless, agent-scriptable, narration synced, captions, <$0.50 cost.

**LATER — the reusable tool:**
- Real `DEMO_SCRIPT.md` parser; full `demo.config.json` parameterization (URLs/voice/theme).
- Automated UiPath login + same-context recording (retire the manual pre-capture).
- `verify.ts` gate (runtime/segment/parity assertions) as a self-policed-but-artifact-bound check.
- Remotion title cards / lower-thirds / outro as the polish layer.
- Optional coder/agent-tty terminal B-roll ("100% built by agents" montage).
- Package + register the Claude Code skill; document a runbook (rollout/monitor/validate/rollback) per estate AGENTS.md.

---

### Key citations
- Playwright video recording (CDP-level, WebM): https://playwright.dev/docs/videos
- ElevenLabs TTS with-timestamps (audio + char alignment): https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- ElevenLabs forced-alignment (fallback): https://elevenlabs.io/docs/api-reference/forced-alignment
- ElevenLabs API pricing: https://elevenlabs.io/pricing/api
- Playwright demo-video pattern (fake cursor + overlays): https://justin.abrah.ms/blog/2026-02-12-generating-demo-videos-with-playwright.html
- knightli Playwright-CLI overlay API: https://knightli.com/en/2026/04/15/playwright-cli-video-recording/
- playwright-recast (trace→narrated MP4, MIT): https://github.com/microsoft/playwright/issues/5160 (cursor jank) ; recast write-up: https://dev.to/thepatriczek/i-was-tired-of-re-recording-product-demos-every-sprint-so-i-built-a-tool-that-turns-playwright-21od
- Remotion render / renderMedia / license / captions: https://www.remotion.dev/docs/render , https://www.remotion.dev/docs/renderer/render-media , https://www.remotion.dev/docs/license , https://www.remotion.dev/docs/captions
- Xvfb + ffmpeg x11grab headless recording (fallback): https://malinowski.dev/recording-headless-selenium-tests-to-mp4.html
- Tamir Dresher reference pipeline: https://www.tamirdresher.com/blog/2026/03/05/ai-produced-demo-video
- coder/agent-tty (deterministic terminal capture): https://github.com/coder/agent-tty
- ffmpeg subtitles burn-in: https://www.ffmpeg-micro.com/blog/ffmpeg-subtitles-filter-guide
