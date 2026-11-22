# Zoom shot planner

## Outcome

A demo's camera moves like an editor cut it: it is already on the action when the action happens, stays there long enough to show the result, and does not bounce in and out between nearby actions.

## Behavior

`motion.shotPlanner: true` selects the plan for screencast shots. It is off by default.

- Actions up to 3 s apart share one zoom when they fit in one frame with a 12% margin.
- The zoom lands 0.5 s before the first action and holds 1.5 s after the last, for at least 1.8 s.
- Zoom depth is the deepest that frames the group, capped at `motion.zoomLevel`. A group needing less than 1.25x (or `zoomLevel`, if lower) is split.
- Two zooms keep at least 1.5 s of wide shot between them. Closer zooms merge if they fit one frame. Otherwise the one with fewer actions is dropped, and the later one on a tie.
- A zoom that could only arrive after all of its actions is dropped.
- Every shot starts and ends at `motion.baseZoom`, centered.

## Compatibility

- `motion.zoomOnAction: false` still disables all camera motion.
- The planner takes precedence over `motion.livingCamera`, and keeps `baseZoom` and drift.
- The key has no schema default, so configs that omit it keep their parsed shape and config digest.

## Boundaries

Bounds apply per captured shot because each shot is encoded separately. The plan does not hold a zoom across a cut and does not add a whole-video wide opening.

## Test seam

`planZoomShots` and `plannedCameraKeyframes` are pure functions of events and options. `src/zoom-shots.test.ts` covers grouping, yo-yo resolution, bounds, keyframes, mode selection, and the config digest guard.
