# The self-demo

A video the tool renders of itself: a small release-checklist app (`app.html`), then a showcase
page (`showcase.html`) with the script, a replay of a real run, the quality checks from an earlier
render, and the install line. Both pages work offline.

`showcase.html` is generated; never edit it by hand. Its inputs are `DEMO_SCRIPT.md`,
`assets/run.log`, `assets/report.json` and `assets/contact-sheet.png`.

## Silent pass

From the repository root:

```bash
FAKE_TTS=1 pnpm demo demos/self/demo.config.json 2>&1 | tee run.log
```

The video lands in `demos/self/out/` (git-ignored).

## Refresh the showcase from a render

```bash
pnpm tsx demos/self/build-showcase.ts --refresh <out-dir> <log-file>
```

This writes a sanitized log, a trimmed report (only the fields the showcase shows, never the voice
configuration) and a resized contact sheet into `assets/`, then regenerates `showcase.html`. Run
`pnpm tsx demos/self/build-showcase.ts` alone to regenerate the page from the committed assets.
A test fails if the committed showcase or report no longer matches the script, so refresh after any
script change.

## Narrated render

Copy `demo.config.json` to a file outside the repository, set `script` to the absolute path of
`DEMO_SCRIPT.md`, `dashboardBaseUrl` to the `file://` URL of this folder, `out` to a new directory,
and add your own `voice` block with an `aligner` (see [voice](../../docs/guide/voice.md)). Keep that
file out of the repository. Render it twice: refresh the showcase from the first narrated render,
then render again, so the video shows real checks from a narrated render.
