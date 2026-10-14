# Motion Cards: animated title and end cards rendered with HyperFrames

## Intent

The title and end cards are static text faded in and out. Viewers read static text cards as
slides, and the field's agent-built videos use animated type for these moments. HyperFrames
(Apache-2.0, an agent-oriented HTML-to-video renderer) renders HTML animations frame by frame and
deterministically. This change lets an author opt into motion cards rendered with it, without
adding weight for anyone who does not.

## Vocabulary

- **motion cards**: title and end cards rendered as animated HTML by HyperFrames instead of static
  text drawn by ffmpeg.
- **static cards**: today's cards; still the default.
- **settle**: a small scale change on text that is already fully visible (it never hides text).
- **reveal**: secondary text (product name, subtitle, URL) animating from hidden to visible.

## Scenarios (tracer-bullet slices)

1. **Opt-in, no new weight by default.** A new `brand.motion: true` turns on motion cards. Without
   it, cards render exactly as before. Motion cards need the optional HyperFrames package, installed
   separately at the pinned version; installs without it keep the original dependency footprint.
2. **Motion cards replace static cards in place.** With motion on, the title and end cards carry the
   same text (title, subtitle, hook, URL), the same durations, canvas size, frame rate, backdrop
   colors and accent color, and occupy the same positions in the video as static cards. The rest
   of the pipeline (narration, captions, verification, contact sheet, report) is unchanged.
3. **The hook is legible on the first frame.** When the title card has a hook, the hook is fully
   visible at full opacity on the first frame and only settles (a slight scale down) over the
   first half second; the accent bar draws on, then the product name and subtitle reveal. Without
   a hook, the product name is fully visible on the first frame and settles. On the end card the
   title fades in and the URL reveals.
4. **Author text is inert.** Title, subtitle, hook and URL are inserted as escaped text, never as
   markup or script, so no author text can change the card's structure or run code.
5. **Missing pieces fail loudly.** If motion is on and HyperFrames is not installed at the pinned
   version, the Node version is below what HyperFrames requires, the card settings cannot be built
   into a motion card, or the render fails, the run stops with a message naming the cause and how
   to fix it. It never silently falls back to static cards.
6. **Reproducible and recorded.** The render report records that motion cards were used and the
   HyperFrames version. HyperFrames runs without a shell, isolated from the desktop display like
   every other headless browser in the pipeline.

## Behavior details

- The requirement and card-validation check runs before any browser, voice or capture work, and
  only when motion is on and at least one card is enabled.
- A different HyperFrames version is rejected; the message gives the install command for the
  pinned version.
- Card size must be even and positive, the frame rate a whole number, and each card at most 60 s
  long.
- Short cards compress their animations so every reveal finishes before a 0.4 s closing fade.
- Motion cards use the configured font family through a local font face; no web fonts are fetched.
- HyperFrames telemetry, update checks and auto-install are disabled for these renders.
- A render that exits cleanly but reports page errors, unresolved fonts or failed resources is
  treated as failed, and a failed card leaves no output file.
- On timeout or interruption, HyperFrames is asked to shut down (so it can stop its own browser
  and encoder) before it is killed.

## Out of scope

- Animated hooks that start hidden (they would break the first-frame rule).
- Motion inside shots, transitions between shots, or animated captions.
- Templates or themes beyond the existing colors, accent and font.
- HyperFrames' cloud rendering, Studio, or skills.

## Acceptance criteria

- AC1: a config without `brand.motion` produces byte-identical static card commands and the same
  report as before; `brand.motion` absent or false never loads HyperFrames.
- AC2: with `brand.motion: true`, a render produces title and end card segments with the
  configured canvas size, frame rate and durations, and the final video passes the existing
  deliverable verification.
- AC3: the first frame of a hooked motion title card shows the hook (the hook area is not blank and
  not dark), and the card's HTML gives the hook no hidden or transparent starting state.
- AC4: author text containing markup characters (`<`, `>`, `&`, quotes) renders as literal text and
  the generated HTML contains no unescaped author markup.
- AC5: with HyperFrames absent or at a different version, Node below its minimum, or card settings
  a motion card does not support (a size that is odd or not positive, a fractional frame rate, a
  card longer than 60 s), a motion render stops before any browser, voice or capture work with a
  message naming the requirement; a failing HyperFrames render, including one that exits cleanly
  but reports page errors, unresolved fonts or failed resources, stops with a message naming the
  card and leaves no output file for it.
- AC6: the report records `motionCards: { renderer: "hyperframes", version }` when used.
- AC7: HyperFrames runs with telemetry, update checks and auto-install disabled and without the
  desktop display; on timeout or interruption it is asked to shut down before it is killed.

## Test seams

Existing seams: the card builder (unit tests on the generated HTML: escaping, durations, colors,
the hook's first-frame state), the pipeline smoke test (one end-to-end motion render with a frame-0
probe, and an unsupported card setting rejected before narration), the requirement check (unit
tests with the dependency, its version and the Node version stubbed), and the card renderer run
against a stand-in HyperFrames (its environment, the log scan, and shutdown on timeout).
