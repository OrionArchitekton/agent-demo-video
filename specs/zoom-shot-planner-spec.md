# Zoom shot planner

## Outcome

A demo's camera moves like an editor cut it: it is already on the action when the action happens, stays there long enough to show the result, and does not bounce in and out between nearby actions.

## Behavior

`motion.shotPlanner: true` selects the plan for screencast shots. It is off by default.

- Actions up to 3 s apart share one zoom when their whole target rectangles fit in one frame with a 12% margin. A target too large to frame gets no zoom.
- The zoom lands 0.5 s before the first action and holds 1.5 s after the last one finishes, for at least 1.8 s. At a segment boundary, the lead or tail may shorten, but every kept action stays inside the fully zoomed span. An action that cannot is left out.
- Zoom depth is the deepest that frames the group, capped at `motion.zoomLevel`. A group that would need less than `baseZoom`, or less than 1.25x (or `zoomLevel`, if lower), is split.
- Two zooms keep at least 1.5 s of wide shot between them. Closer zooms merge if they fit one frame. Otherwise the one with fewer actions is dropped, and the later one on a tie.
- Every shot starts and ends at `motion.baseZoom`, centered.

## Compatibility

- `motion.zoomOnAction: false` still disables all camera motion.
- The planner takes precedence over `motion.livingCamera`, and keeps `baseZoom`. It adds no drift, so a fitted zoom and the shot ends stay exact.
- The key has no schema default, so configs that omit it keep their parsed shape and config digest.

## Boundaries

Bounds apply per captured shot because each shot is encoded separately. The plan does not hold a zoom across a cut and does not add a whole-video wide opening.

## Test seam

`planZoomShots` and `plannedCameraKeyframes` are pure functions of events and options. `src/zoom-shots.test.ts` covers grouping, yo-yo resolution, bounds, keyframes, mode selection, and the config digest guard.
