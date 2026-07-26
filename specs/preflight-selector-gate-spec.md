# Pre-flight Selector Gate - Spec

Status: active (closes issues #13 and #14)

## Problem

A DEMO_SCRIPT can declare selectors that do not identify what the author meant, and
nothing tells the author until narration has already been paid for.

Three distinct defects, each verified against `0d940d5`:

1. **The highlight overlay is fail-open as a function.** `window.__demoHighlight`
   hides its box and returns when `document.querySelector` misses, and
   `querySelector` silently takes the FIRST match when a selector is ambiguous.
   The capture path currently happens to guard this with a strict Playwright
   locator, so the overlay's own fail-open behaviour is masked rather than absent:
   any other caller of the overlay API gets a silent no-op, and the two resolutions
   (locator, then in-page `querySelector`) are independent, so they can disagree.

2. **A selector mistake is reported late, expensively, and unreadably.** A
   zero-match highlight selector stalls the full 30s locator timeout mid-render and
   then reports `locator.scrollIntoViewIfNeeded: Timeout 30000ms exceeded` - naming
   neither the shot, nor the selector, nor the fact that a highlight was involved.
   An ambiguous selector reports a raw Playwright strict-mode violation. Both land
   AFTER every shot's narration has been synthesized, so a script-authoring typo
   costs TTS spend. The sibling `click` action already throws a shot-scoped message;
   `highlight` is the only selector-bearing action without one.

3. **A shot that never navigates is a structural trap.** `captureShot` builds a
   fresh browser context per shot, so a browser-driven shot carrying selectors but
   no `goto` action runs against `about:blank`, where every locator waits out its
   full timeout. Nothing detects this before the render.

Separately, `clipsDir` is declared in the config schema and documented in the README
but read by no code path: prebaked `clip:` paths resolve against the process CWD, so
the same config finds different files depending on where it was invoked from.

## Goal

A script author learns that a selector is wrong BEFORE any narration is synthesized,
in a message that names the shot, the selector, and what the selector actually
matched. The overlay API is fail-closed on its own terms rather than by accident of
its caller. Prebaked clip resolution is deterministic and independent of CWD.

Existing configs that are correct keep rendering unchanged.

## Scenarios (tracer-bullet slices, dependency order)

### S1 - Structural findings without a browser

Given a parsed manifest, when the pre-flight stage inspects it, then every
browser-driven shot that references a selector but declares no `goto` action is
reported as a finding that names the shot and states that a fresh context per shot
means the shot would run against a blank page. A `prebaked` shot that declares
selector-bearing actions is reported too, because a prebaked shot short-circuits
capture and never runs its actions. A shot with no selectors is not reported. This
analysis requires no browser and no network.

### S2 - Selector resolution against the page each shot actually opens

Given a manifest whose shots carry selectors, when the pre-flight stage resolves
them, then each selector is resolved against the URL in effect AT THAT POINT in the
shot (a shot may navigate more than once), and a selector is a finding unless it
matches exactly one element. Zero matches, more than one match, and an unparseable
selector are reported as three distinguishable findings, each naming the shot, the
selector, and the observed match count. Shots that share a URL resolve against a
single navigation, in a context as fresh as the one capture builds, so the gate's
verdict never depends on the order shots are declared in.

### S2b - The gate may only BLOCK on a claim it can actually make

The gate resolves against a freshly-loaded page and deliberately runs no actions,
so its evidence is weaker than the render's in four specific ways. In each, the
finding is reported at INFO and does not block:

- a selector downstream of a click or type in the same shot, which the gate cannot
  see because it runs no actions;
- an ambiguous `hover`, because capture resolves hover non-strictly and it renders;
- an auth-walled `live` shot, because the gate runs unauthenticated and would see
  the login wall;
- a page that did not settle before counting.

Conversely, the gate must be no stricter than the render where it CAN judge: it
resolves with the same engine capture uses (so Playwright selector syntax and
shadow-DOM piercing behave identically), it counts the page with the same overlay
elements capture injects, and it waits for a late-hydrating element rather than
counting once instantly.

### S3 - The gate runs before spend, and can be declined

Given a demo run, when the pipeline starts, then the pre-flight stage runs before
any narration is synthesized and before any capture, and a run with findings fails
with a report of every finding and no TTS spend. An operator may decline the gate
through configuration or a command-line flag, and declining is reported in the run
output rather than silent. A script with no findings renders exactly as it did
before the gate existed.

### S4 - The highlight overlay fails closed on its own terms

Given the injected overlay API, when a highlight is requested for a selector that
matches zero elements or more than one, then the overlay raises rather than hiding
its box and returning. Given the highlight action in a capture, when its selector
does not resolve to exactly one element, then the run fails with a message naming
the shot, the selector, and the observed count, and pointing at the pre-flight gate.
A selector that resolves to exactly one element after an initial delay still
succeeds: the action retains the auto-waiting behaviour it has today.

### S5 - Prebaked clips resolve deterministically

Given a config that declares `clipsDir`, when a prebaked shot references a clip,
then a bare filename resolves inside `clipsDir`, a path containing a separator
resolves against the config file's directory, and an absolute path is used as
given. `clipsDir` itself resolves against the config file's directory. The same
config finds the same clip from any working directory. A clip that does not exist
at the resolved path fails with a message naming the path that was tried, never a
silent fallback to a different path.

## Constraints

- The gate is fail-closed by default with an explicit, reported opt-out.
- Pre-flight must not become a second, divergent definition of "resolves": it
  reports a selector as good only under the same exactly-one rule the capture path
  enforces.
- No new runtime dependency. Pre-flight uses the Playwright already required.
- Selectors are passed to the page as arguments, never interpolated into evaluated
  source.
- Existing configs and scripts that are correct today must render unchanged.

## Acceptance criteria

- A script with a zero-match, an ambiguous, and a never-navigating shot fails
  pre-flight naming all three, and writes no audio artifact.
- A shot whose element hydrates in after load passes the gate, as it renders.
- A selector using Playwright engine syntax passes the gate, as it renders.
- A selector revealed by an earlier click is reported at INFO and does not block.
- The render receipt records whether the gate ran, was declined, and which shots
  it could not adjudicate.
- The same script with those three corrected renders to completion.
- Declining the gate restores the pre-gate behaviour and says so in the output.
- The overlay init script raises on a non-unique selector.
- A prebaked config renders identically from two different working directories.

## Test seams

Two seams, both already load-bearing in this repo:

- `src/preflight.ts` unit tests (`src/preflight.test.ts`) for S1 and for finding
  formatting - pure functions over a parsed manifest, no browser.
- `tests/preflight.smoke.test.ts` for S2/S3/S4 - real Chromium against
  `tests/fixtures/page.html`, the same seam `tests/capture.smoke.test.ts` uses.
- S5 rides the existing `src/config.test.ts` seam for resolution and
  `tests/capture.smoke.test.ts` for the prebaked short-circuit.

## Verification

- run: `pnpm test`
- expect: `Test Files` all passed, exit 0
