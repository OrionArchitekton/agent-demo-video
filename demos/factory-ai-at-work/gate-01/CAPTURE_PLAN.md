# Gate 1 Capture Plan

All footage is captured from real runs owned by the operator. Nothing in this
plan authorizes connecting sensitive folders, exposing credentials, or
publishing an artifact.

## Common clip contract

- Master clips are finished 1920x1080 compositions at 30 fps.
- Cut clips are finished 1080x1920 compositions at 30 fps.
- Encode H.264 with yuv420p pixel format, square sample pixels (`1:1` SAR), and
  no embedded narration.
- Keep captions out of the source clip. The pipeline burns the pinned captions.
- Blur credentials, account identifiers, notifications, and unrelated files.
- Use only footage captured for this episode or other rights-clean operator
  footage.
- Every clip is declared `fullBleed: true`; it already owns its framing,
  reframing, labels, motion, and brand cards.
- Match the real file count, prompt, elapsed time, formula cells, notifications,
  and session state shown in the capture. If the run differs, update narration
  and the run receipt before render.
- Do not use generated product screens or staged timestamps.

Place clips in these ignored directories relative to this pack.
The rehearsal reads these working files. Before real narration, the runbook
copies the exact twelve files into the fresh attempt's `evidence/clips/` tree;
production preflight and render read only those owned copies.

## Master clips

| File | Evidence job |
|---|---|
| `clips/master/01-cold-open.mp4` | Finished organized folder and formula-backed spreadsheet, then the same real folder before organization and the Windows Claude entry point. |
| `clips/master/02-roadmap.mp4` | Four-step strip plus honest Windows 11 and local-versus-cloud setup. |
| `clips/master/03-setup.mp4` | Paid-plan, Windows-version, and admin-rights checklist with no credential or account detail. |
| `clips/master/04-install-it-right.mp4` | Real download, UAC approval, Start-menu sign-in boundary, Virtual Machine Platform setting, restart, and the Cowork selector payoff. |
| `clips/master/05-first-real-task.mp4` | Real staged folder, exact typed prompt, plan, any permission request that actually occurred, folder changes, spreadsheet, and formula spot check. |
| `clips/master/06-where-it-runs.mp4` | Remote-session receipt, lid-close continuation, local-file gate, Hyper-V diagram, safety guidance, and second-device progress with real timestamps. |
| `clips/master/07-anywhere-on-a-schedule.mp4` | Same session on web and phone, a real notification, local-file boundary, scheduled task, on-demand run, and the resulting digest. |
| `clips/master/08-recap.mp4` | Four real payoff shots replayed in order. |
| `clips/master/09-next.mp4` | Channel close with one subscribe action and the next episode topic. |

The pipeline generates the final 15 second disclosure card. Do not prepend a
title card: the first frame must be the finished artifact.

## Portrait cut clips

| File | Evidence job |
|---|---|
| `clips/cut-a/cut-a-install.mp4` | Portrait reframe of the real UAC, Virtual Machine Platform, restart, and Cowork-selector sequence. |
| `clips/cut-b/cut-b-real-job.mp4` | Portrait reframe of the real folder, exact prompt, work progression, folder result, and formula spot check. |
| `clips/cut-c/cut-c-remote.mp4` | Portrait composition of the remote-session receipt, lid-close continuation, desktop-file gate, and safety boundary. |

## Run-dependent receipts

Before a production render, record these in the attempt's copied
`PRODUCTION_RECEIPT.md`:

1. Exact source folder file count and a content inventory showing it contains no
   sensitive documents.
2. Exact Cowork prompt used in the run.
3. Whether Cowork showed a permission prompt. If it did not, no permission
   prompt may appear in footage.
4. Real elapsed timestamps for task progress and lid-close continuation.
5. Desktop, web, and phone proof for any narration that says the session is on
   every device.
6. The spreadsheet formula cells spot checked and their expected totals.
7. The source URLs and access date for every vendor claim shown as a receipt.

## Mechanical checks

For every clip:

```bash
ffprobe -v error \
  -select_streams v:0 \
  -show_entries stream=width,height,pix_fmt,r_frame_rate,sample_aspect_ratio \
  -of default=noprint_wrappers=1 <clip.mp4>
```

Expected master geometry is `1920x1080`; expected cut geometry is `1080x1920`;
pixel format is `yuv420p`; frame rate is `30/1`; sample aspect ratio is `1:1`.
The renderer and preflight both inspect `v:0`, and normalization pins that same
stream.
