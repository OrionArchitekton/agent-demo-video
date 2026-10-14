# Third-party tabs

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

Back to the [README](../../README.md).
