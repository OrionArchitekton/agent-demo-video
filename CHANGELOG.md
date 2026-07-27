# Changelog

## Unreleased

### Added

- `platform` distribution preset. `"shorts"` renders a 9:16 `1080x1920` canvas for
  Shorts/TikTok/Reels cuts while still capturing web apps at a 16:9 desktop viewport;
  the framed scene keeps the capture's aspect for the floating window, so nothing is
  letterboxed inside it. Explicit `resolution` and the new `capture.viewport` each
  override their preset value; configs that declare no `platform` behave exactly as
  before. Render manifests carry the capture geometry (`contentSize`) so remote
  renders match local ones; older manifests without it render unchanged. All video
  encode call sites now draw CRF/preset from one policy (`X264`), preserving the
  historical values (frames 18, composite 20).

### Breaking

- A prebaked `clip:` that does not exist at its resolved path now fails immediately,
  naming the path that was tried. Previously the declared path was returned verbatim and
  the run failed later, inside ffmpeg, against a path nobody had resolved. (#14)
- `clip:` paths no longer resolve against the process working directory. A bare filename
  resolves inside `clipsDir`; a path carrying its own directory resolves against the
  config file's directory; an absolute path is used as given. Configs that referenced
  clips relative to their config file, or by bare filename as the README described, keep
  working. A config that relied on being invoked from a particular directory does not.

### Added

- Pre-flight selector gate. Every selector a script declares is resolved against the page
  its own shot opens at that point, before any narration is synthesized, and the run
  refuses to start when a selector provably will not do what the script says. It also
  reports a shot that references a selector but never navigates (capture builds a fresh
  context per shot, so that shot runs against `about:blank`), a `prebaked` shot declaring
  selector actions capture never runs, a selector-requiring action declared without a
  selector, and a prebaked clip missing at its resolved path. Fail-closed; `preflight:
  false` or `--no-preflight` declines it, and a declined run says so. (#13)

  The gate blocks only on claims it can actually make. It resolves with the same selector
  engine capture uses (so Playwright syntax such as `>> nth=` and shadow-DOM piercing
  behave identically), against a page carrying the same injected overlay, and waits for an
  element that hydrates in after load. Where its evidence is genuinely weaker than the
  render's it reports at `INFO` instead: a selector behind an earlier `click`/`type` in the
  same shot, an ambiguous `hover` (which capture resolves non-strictly), an auth-walled
  `live` shot, and a page that did not settle before counting.
- `out/render-report.json` records whether the gate ran, whether it was declined, and which
  shots it could not adjudicate, so a finished video states how it was checked.
- `preflightWaitMs` (default 30000) budgets how long the gate waits for a selector absent at
  first count. It defaults to the render's own selector budget, which capture now passes
  explicitly from a shared constant so the two cannot drift. Lowering it makes the gate
  faster and stops it BLOCKING on absence: with a shorter budget its evidence is weaker
  than the render's, so absence is reported at `INFO` instead.
- `clipsDir` is now read. It was declared in the schema, defaulted, and documented in two
  places while no code path consulted it. (#14)

### Fixed

- `window.__demoHighlight` no longer fails open. A selector matching nothing hid the
  highlight box and returned, so the shot rendered, the run exited 0, and the highlight
  never happened. An ambiguous selector is a failure too, because `document.querySelector`
  silently takes the first match, which is how a bare `p` or `code` selector looks correct
  while pointing at the wrong element. (#13)
- A failing `highlight` action now names the shot, the selector, and the real match count.
  It previously surfaced as a raw Playwright strict-mode violation, or as a bare
  `Timeout 30000ms exceeded` on a zero match, identifying neither the shot nor the action.
  The locator still does the waiting, so an element that appears after load still works,
  and a failure that is NOT a count problem (a hidden but unique element, a closed page)
  now rethrows the original error rather than being mislabelled as one.
- The highlight overlay is driven by a rectangle capture already resolved with Playwright,
  instead of re-resolving the selector in the page with `document.querySelectorAll`. The
  two engines disagree on shadow DOM and on Playwright-only selector syntax, so an element
  inside an open shadow root previously drew no highlight at all.

## 0.3.0

### Breaking

- A missing `ELEVENLABS_API_KEY` is now an error instead of silently selecting
  silent placeholder narration. Previously a forgotten credential produced a
  complete, correctly-timed, captioned video with no voice at all, and the
  parity check could not detect it because the estimated duration is the clock.
  Set `FAKE_TTS=1` to request silent narration deliberately.

### Added

- `maxDurationSec` (default 300) declares the finished video's length ceiling.
  It replaces a hardcoded constant and is carried across the render manifest, so
  a remote render enforces the same limit as a local one.
- `capture.settleMs` (default 500) budgets a readiness wait after the opening
  navigation: web fonts ready and visible images decoded. Fails open, warning and
  recording anyway. `0` disables it silently. Under the default `screencast`
  engine the wait completes before recording starts, so unsettled frames are
  excluded. The legacy `recordvideo` engine binds capture at context creation, so
  there the wait shifts those frames later instead of excluding them.
- `<out>/render-report.json` records what produced a render: resolved voice and
  model, toolchain versions, config and script digests, the measured per-shot
  timeline, and the parity result.

### Fixed

- Every config schema object now rejects unrecognised keys, so a typo in a
  setting fails loudly instead of silently applying the default it was written
  to override.
- Offloading to a remote render bundle older than the local sources is refused.
  A stale bundle ran an old renderer that ignored the declared duration cap.
