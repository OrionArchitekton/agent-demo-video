# Optional opening scene

An optional opening scene replaces three to four seconds of the first captured
shot. It adds no time or audio segment. Captions and narration retain their
existing timeline and appear above the scene. The feature is off when
`optionalIntro` is absent. Disable the title card explicitly when using a brand:

```json
{
  "brand": { "title": "My product", "titleCard": false },
  "optionalIntro": { "asset": "art/opening.mp4", "durationSec": 4 }
}
```

This is a config fragment; keep the usual script, URL, voice and output settings.
Use a fresh output directory for each opted-in attempt. Existing output paths
are refused before capture or narration. Prepared asset and receipt paths
resolve relative to the config file, including when launched from another folder.

The scene must show exactly the first selected interval of the actual first
capture. Its screen action must end front-on for a match cut back to the same
shot. Review UI readability at oblique and bright frames. Keep hook text and
captions outside the screen texture. Receipts record the renderer/operator's
attestation; reviewing the actual media remains necessary for authenticity.

The asset must contain one silent video stream, square pixels, the exact output
canvas and configured frame rate, and the selected duration within half a frame.
Landscape and portrait canvases are both supported. Choose a duration that is a
whole number of frames. Do not stretch desktop proof into a portrait screen.

Provide a JSON receipt beside the clip as `art/opening.mp4.json` (or set
`optionalIntro.receipt` to another path):

```json
{
  "version": 1,
  "sourceSha256": "<SHA-256 of the entire original first capture>",
  "sourceStartSec": 0,
  "durationSec": 4,
  "assetSha256": "<SHA-256 of opening.mp4>",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "recipeId": "laptop-scene-v1"
}
```

Use `sha256sum` to obtain full 64-character lowercase hashes. A live capture
usually changes between runs; use the command adapter to prepare its scene from
that run's capture, or use a retained capture as a prebaked first shot. A receipt
for a different run is rejected.

## External renderer

An operator can install any compatible scene renderer, including an adapter for
their own Blender setup. No Blender, scene library, private repository or cloud
account is installed or downloaded by this package. Blender retains its own
license as a separate executable; this package remains MIT.

```json
{
  "optionalIntro": {
    "renderer": [
      "/absolute/path/to/scene-adapter",
      "--source", "{source}", "--output", "{out}",
      "--receipt", "{receipt}", "--request", "{request}"
    ],
    "durationSec": 4,
    "timeoutSec": 1800
  }
}
```

The argument array runs without a shell. `{source}`, `{out}` and `{receipt}` are
required placeholders. `{request}` names a JSON file containing `version`,
`sourceSha256`, `sourceStartSec`, `durationSec`, `width`, `height` and `fps` for this
attempt. `{duration}`, `{width}`, `{height}` and `{fps}` are also available. The
adapter reads the source snapshot, maps only its specified initial interval,
writes a silent clip to `{out}`, and writes the receipt above to `{receipt}`.
It adds the asset hash and a recipe ID of 1-128 letters, digits, dots, underscores
or hyphens. All output paths belong to this attempt; previous assets are never
reused as a successful command result.

Executable paths in argv should be absolute or discoverable on `PATH`; data
paths should be explicit. Only executable/locale/temp discovery environment
variables are inherited, without narration-provider credentials. The adapter
owns its separately configured tools. This slice has no remote preparation
adapter or retry protocol; preparation runs locally before either render path.
Do not detach work into another session or submit an uncancellable remote job.

The deadline covers external preparation, defaults to 1800 seconds, and accepts
1-3600 seconds. The existing owned-process runner sends TERM to the attempt's
group and allows five seconds before KILL through its live supervisor. It does
not signal unrelated renderers. No renderer retry occurs. An unavailable tool,
invalid candidate or timeout records a fallback and preserves the original
shot. A title card records `title_card_enabled`; a short first capture records
`source_too_short`. Both skip the tool entirely. Failed preparation artifacts
and a small reason record remain under `optional-intro/attempt-*`.

After acceptance, both render paths verify a snapshot's byte length, SHA-256,
source identity and recipe. Remote manifests carry its relative staged path and
metadata; the clip travels alongside capture and narration. A missing, changed,
or escaping staged asset is a fatal integrity error. Main-render, transport,
source-attestation, output-ownership, aspect and parity errors remain fatal.

## Advisory look check

Optionally configure an external checker with the following command interface:

```json
{
  "lookCheck": {
    "command": [
      "/absolute/path/to/look-checker", "{video}",
      "--profile", "{profile}", "--start", "{start}", "--dur", "{duration}"
    ],
    "timeoutSec": 120
  }
}
```

The interface accepts the external scene kit's `look` command. It must print a
JSON object with `profile: "motion"`, `passed`, and `metrics` containing
`motion_pct`, `contrast`, `luma_mean` and `secs_measured`. A nonzero exit is a
failure when valid metrics are available. Missing tools, invalid output and
incomplete measurements are unavailable. The timeout accepts 1-3600 seconds.

The pipeline measures the complete final MP4, and separately its intro and
remaining body when a scene was used. Floors stay at 30 percent motion, 100
contrast and 50 brightness. Look results live in `render-report.json` beside
the existing deliverable, parity, transcript and contact-sheet diagnostics.
Raw checker output remains under `look-check/`. All look results are advisory.
An unavailable checker never becomes a pass. An attractive four-second opening
does not establish that the complete demonstration passes.

## Optional thumbnail workflow

Thumbnail art is a separate operator action. Ordinary MP4 rendering invokes no
image generator and emits no thumbnail. From a reviewed external scene render,
inspect 4-8 stills covering the strongest angle, brightest frame and front-on
finish, then explicitly extract one candidate, for example:

```bash
ffmpeg -n -ss 3.8 -i reviewed-opening.mp4 -frames:v 1 thumbnail-candidate.png
```

Use the existing image workflow to add a large editable title. Retain the
reviewed still's origin, hash and aspect beside the candidate. Choose it
independently from the video; if the external scene fails, the established
image route remains available. Motion percentages do not apply to stills.

See the [operator runbook](../runbooks/optional-intro.md) for rehearsal,
monitoring and rollback. Shared laptop presets and optional surrounding plates
remain separate scene-tool work; this package does not generate them itself.

Back to the [README](../../README.md).
