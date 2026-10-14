# Motion cards

Set `brand.motion: true` to render the title and end cards as short animated HTML clips with
[HyperFrames](https://github.com/heygen-com/hyperframes) instead of static ffmpeg text. It is opt-in: static cards stay the default, and a config
without `motion` behaves exactly as before.

```json
"brand": { "title": "WorkCue", "hook": "Your standup, written for you", "url": "workcue.app", "motion": true }
```

- **Install.** HyperFrames is an optional peer dependency: it is not installed with
  agent-demo-video, so installs that never use motion cards keep the two-dependency footprint.
  To use motion cards, install exactly version 0.8.155 next to agent-demo-video, in the same
  project (add `-g` when agent-demo-video is installed globally):

  ```bash
  npm install hyperframes@0.8.155
  ```

  Motion cards need Node 22.12 or newer; the tool itself still runs on Node 18 when motion is off.
  The first render may download a headless Chrome.
- **Requirements check.** Before any browser, voice or capture work, the run checks that HyperFrames
  is installed at exactly 0.8.155, that Node is 22 or newer, and that the cards can be built
  (an even, positive canvas size, a whole-number frame rate, cards up to 60 s). If anything is
  wrong the run stops and the message says how to fix it.
- **Title card.** With a hook, the hook is fully visible from the first frame and only settles
  slightly; the accent bar draws on, then the product name and subtitle reveal. Without a hook, the
  product name is visible from the first frame and settles.
- **End card.** The title fades in, then the URL reveals in the accent color.
- **Short cards.** Animations scale down on short cards so every reveal finishes before the fade.
- **Fonts.** Motion cards use the same font family as static cards and captions
  (`theme.captionFont`), through a local font face, so no web fonts are fetched. The hook and the
  large titles are drawn bold.
- **Rendering.** HyperFrames runs its own headless browser, which it may need to download on a
  clean machine the first time it renders. Node 22.12+ and ffmpeg are required. HyperFrames
  telemetry, update checks and auto-install are turned off for these renders. On a timeout or an
  interrupt, HyperFrames is asked to shut down its browser and encoder before it is killed.
- **Failures.** A missing or different HyperFrames version, an old Node, card settings motion cards
  do not support, or a render that fails or logs an error stops the run and leaves no partial card.
  There is no silent fallback to static cards.
- **Report.** The run report records `motionCards: { renderer: "hyperframes", version }`.
- **Text.** Card text is always rendered as literal text, never as markup.

Back to the [README](../../README.md).
