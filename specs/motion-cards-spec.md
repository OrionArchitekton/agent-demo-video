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
   it, cards render exactly as before. HyperFrames is an optional dependency pinned to one exact
   version; installs that never use motion cards are unaffected.
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
5. **Missing pieces fail loudly.** If motion is on and HyperFrames is not installed, the Node
   version is below what HyperFrames requires, or the render fails, the run stops with a message
   naming the cause and how to fix it. It never silently falls back to static cards.
6. **Reproducible and recorded.** The render report records that motion cards were used and the
   HyperFrames version. HyperFrames runs without a shell, isolated from the desktop display like
   every other headless browser in the pipeline.

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
- AC5: with HyperFrames absent, or Node below its minimum, a motion render stops before capture
  with a message naming the missing requirement; a failing HyperFrames render stops with a message
  naming the card.
- AC6: the report records `motionCards: { renderer: "hyperframes", version }` when used.

## Test seams

Existing seams: the card builder (unit tests on the generated HTML: escaping, durations, colors,
the hook's first-frame state), the pipeline smoke test (one end-to-end motion render with a frame-0
probe), and the requirement check (unit tests with the dependency and Node version stubbed).
