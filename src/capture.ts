/**
 * capture.ts — Playwright recordVideo capture driver
 *
 * Launches a Chromium context with video recording enabled, executes the shot's
 * action sequence, pads to the declared duration, and returns the recorded WebM.
 *
 * Two context flavours:
 *  - dashboard/uipath/terminal: a fresh headless context (no persisted state);
 *  - live: a headless PERSISTENT context backed by a saved auth profile, so an
 *    authenticated SaaS app can be driven. A separate `captureLogin` step creates
 *    that profile interactively (headed). prebaked short-circuits to a supplied clip.
 */

import { chromium, type Page } from "playwright";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { frameDurations, framesConcatContent, frameTimestampsToSec, cursorMode } from "./screencast.js";
import { ffmpeg, framesEncodeArgs } from "./ffmpeg.js";
import { zoomFilterExpr, cameraFilterExpr, cameraMode, type InteractionEvent } from "./motion.js";

/** Collects capture-relative interaction events during a screencast recording. */
interface EventRecorder {
  /** Wall-clock ms of the first frame's arrival; 0 until it lands. */
  t0: number;
  /** Wall-clock ms just after start() resolved; anchor for events that fire before the first frame. */
  fallbackT0: number;
  events: InteractionEvent[];
}

function recordEvent(
  recorder: EventRecorder | undefined,
  kind: string,
  box: { x: number; y: number; width: number; height: number } | null,
): void {
  if (!recorder || !box) return;
  const anchor = recorder.t0 || recorder.fallbackT0;
  if (anchor === 0) return;
  recorder.events.push({ kind, tMs: Math.max(0, Date.now() - anchor), box });
}
import {
  overlayInitScript,
  moveCursorExpr,
  clickExpr,
  chapterExpr,
  highlightExpr,
  cssInjectScript,
} from "./overlay.js";
import { resolveProfileDir } from "./profile.js";
import type { Shot, DemoConfig, TimelineEntry } from "./types.js";

/**
 * Resolves a URL relative to the dashboardBaseUrl.
 * Absolute URLs (http/https/file:) are returned as-is.
 */
function resolveUrl(u: string, baseUrl: string): string {
  if (u.startsWith("http") || u.startsWith("file:")) return u;
  const base = baseUrl.replace(/\/$/, "");
  return base + (u.startsWith("/") ? u : "/" + u);
}

/**
 * Run a shot's declared action sequence against an already-open page.
 * `onGoto` (if given) fires immediately after EACH navigation completes and BEFORE the
 * next action — the live path uses it to verify the session is authenticated after every
 * navigation, so a click/type never executes against a (re-walled) logged-out page even
 * when a single shot navigates more than once.
 */
async function runActions(
  page: Page,
  shot: Shot,
  config: DemoConfig,
  onGoto?: () => Promise<void>,
  recorder?: EventRecorder,
): Promise<void> {
  const mode = cursorMode(config.capture.engine, config.theme.annotations.enabled, config.theme.cursor);
  for (const a of shot.actions) {
    switch (a.kind) {
      case "goto":
        await page.goto(resolveUrl(a.url ?? "/", config.dashboardBaseUrl), { waitUntil: "load" });
        if (onGoto) await onGoto();
        break;
      case "chapter":
        if (mode === "native") {
          await page.screencast.showChapter(a.label ?? a.text ?? "");
          await page.waitForTimeout(2000);
        } else {
          await page.evaluate(chapterExpr(a.label ?? a.text ?? ""));
          await page.waitForTimeout(800);
        }
        break;
      case "click": {
        if (!a.selector) throw new Error(`shot ${shot.id}: click action missing selector`);
        // Scroll first so the measured box matches what the viewer sees:
        // Playwright would auto-scroll during the action anyway, and a
        // pre-scroll box would aim the zoom at the wrong screen region.
        const loc = page.locator(a.selector);
        await loc.scrollIntoViewIfNeeded();
        const box = await loc.boundingBox();
        if (!box) throw new Error(`shot ${shot.id}: selector not found or has no bounding box: ${a.selector}`);
        recordEvent(recorder, "click", box);
        if (mode === "overlay") {
          const cx = Math.round(box.x + box.width / 2);
          const cy = Math.round(box.y + box.height / 2);
          await page.evaluate(moveCursorExpr(cx, cy));
          await page.waitForTimeout(300);
          await page.evaluate(clickExpr());
        }
        await page.click(a.selector);
        break;
      }
      case "type": {
        if (!a.selector) throw new Error(`shot ${shot.id}: type action missing selector`);
        const loc = page.locator(a.selector);
        await loc.scrollIntoViewIfNeeded();
        recordEvent(recorder, "type", await loc.boundingBox());
        // Native action titles render the action's text on screen; for a type
        // action that would put the typed string (potentially a credential on
        // a live shot) INTO the video. Hide decorations while typing.
        if (mode === "native") await page.screencast.hideActions();
        try {
          await loc.pressSequentially(a.text ?? "", { delay: 60 });
        } finally {
          if (mode === "native") {
            await page.screencast.showActions({
              cursor: "pointer",
              duration: config.theme.annotations.durationMs,
              fontSize: config.theme.annotations.fontSize,
              position: config.theme.annotations.position,
            });
          }
        }
        break;
      }
      case "hover":
        if (!a.selector) throw new Error(`shot ${shot.id}: hover action missing selector`);
        await page.hover(a.selector);
        break;
      case "highlight": {
        if (!a.selector) throw new Error(`shot ${shot.id}: highlight action missing selector`);
        const loc = page.locator(a.selector);
        await loc.scrollIntoViewIfNeeded();
        recordEvent(recorder, "highlight", await loc.boundingBox());
        await page.evaluate(highlightExpr(a.selector));
        break;
      }
      case "scroll":
        if (a.selector) {
          await page.locator(a.selector).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
        } else {
          await page.evaluate(`window.scrollTo({ top: ${a.y ?? 0}, behavior: "smooth" })`);
        }
        // Let the smooth scroll animation play out on camera.
        await page.waitForTimeout(a.ms ?? 800);
        break;
      case "wait":
        await page.waitForTimeout(a.ms ?? 500);
        break;
      default: {
        const _never: never = a.kind;
        throw new Error(`shot ${shot.id}: unknown action kind: ${_never}`);
      }
    }
  }
}

/**
 * Record `run()` via the screencast engine: CDP JPEG frames are written to a
 * per-shot frames dir as they arrive, then assembled with their per-frame
 * timestamps into an H.264 segment. The last frame's duration runs to the stop
 * instant, measured as (last CDP timestamp + wall-clock elapsed since that
 * frame arrived) so all durations live on the capture clock. Fails closed on a
 * frameless capture — never falls back to another engine.
 */
async function recordWithScreencast(
  page: Page,
  shotId: string,
  config: DemoConfig,
  outDir: string,
  recorder: EventRecorder,
  run: () => Promise<void>,
): Promise<string> {
  const framesDir = join(outDir, `frames_${shotId}`);
  await mkdir(framesDir, { recursive: true });

  const files: string[] = [];
  const timestamps: number[] = [];
  const writes: Promise<void>[] = [];
  let lastFrameWallMs = 0;
  let index = 0;
  let capturedDurationSec = 0;
  // First write failure, captured so a rejected writeFile never becomes an
  // unhandled rejection mid-capture; surfaced shot-scoped after teardown.
  let writeErr: unknown;

  const ann = config.theme.annotations;
  if (cursorMode(config.capture.engine, ann.enabled, config.theme.cursor) === "native") {
    await page.screencast.showActions({
      cursor: "pointer",
      duration: ann.durationMs,
      fontSize: ann.fontSize,
      position: ann.position,
    });
  }

  await page.screencast.start({
    size: config.resolution,
    quality: config.capture.screencastQuality,
    onFrame: (frame) => {
      // Anchor the event clock to the first frame's arrival: video time zero
      // is the first captured frame, not the moment start() resolved.
      if (recorder.t0 === 0) recorder.t0 = Date.now();
      const file = join(framesDir, `f_${String(index++).padStart(6, "0")}.jpg`);
      files.push(file);
      timestamps.push(frame.timestamp);
      lastFrameWallMs = Date.now();
      const write = writeFile(file, frame.data).catch((e) => {
        if (writeErr === undefined) writeErr = e;
      });
      writes.push(write);
      // Returning the promise lets Playwright apply backpressure: the next
      // frame is not delivered until this one is on disk, so a long or
      // high-motion capture cannot outrun storage.
      return write;
    },
  });
  // Fallback event anchor for interactions that fire before the first frame
  // lands; slightly early relative to video time (frame latency), and the
  // first-frame arrival above takes over as the precise anchor.
  recorder.fallbackT0 = Date.now();

  // Teardown never masks a run() failure: the shot error is what the operator
  // must see (e.g. the live-path auth guard), not a secondary I/O error.
  let runErr: unknown;
  try {
    await run();
  } catch (e) {
    runErr = e;
  }
  let teardownErr: unknown;
  try {
    // stop() first so no further frames arrive, THEN measure the tail and
    // snapshot the arrays: a frame flushed during stop() is both included in
    // the timeline and has its write awaited (no truncated JPEG in frames.txt).
    await page.screencast.stop();
    const tailSec = lastFrameWallMs > 0 ? (Date.now() - lastFrameWallMs) / 1000 : 0;
    await Promise.all(writes);
    if (writeErr !== undefined) {
      throw new Error(`shot ${shotId}: failed to persist screencast frames`, { cause: writeErr });
    }
    if (files.length > 0) {
      const tsSec = frameTimestampsToSec(timestamps);
      const stopTs = tsSec[tsSec.length - 1]! + tailSec;
      capturedDurationSec = Math.max(0, stopTs - tsSec[0]!);
      const listPath = join(framesDir, "frames.txt");
      await writeFile(listPath, framesConcatContent(files, frameDurations(tsSec, stopTs)), "utf8");
    }
  } catch (e) {
    teardownErr = e;
  }
  if (runErr !== undefined || teardownErr !== undefined) {
    // Best-effort wipe: on the live path the frames are at-rest screenshots of
    // an authenticated app; never leave them behind on a failed shot.
    await rm(framesDir, { recursive: true, force: true }).catch(() => {});
    if (runErr !== undefined) throw runErr;
    throw teardownErr;
  }

  if (files.length === 0) {
    throw new Error(`shot ${shotId}: screencast captured no frames (engine "screencast" fails closed; set capture.engine to "recordvideo" to use the legacy path)`);
  }

  const segPath = join(outDir, `shot_${shotId}.mp4`);
  try {
    // Persist the interaction event timeline (bounds + capture-relative offsets)
    // as a per-shot artifact; it drives zoom-on-action and is reviewable after.
    await writeFile(join(outDir, `events_${shotId}.json`), JSON.stringify(recorder.events, null, 2), "utf8");

    const durationSec = Math.max(MIN_SEGMENT_SEC, capturedDurationSec);
    const m = config.motion;
    const zoomShape = {
      width: config.resolution.width,
      height: config.resolution.height,
      fps: config.fps,
      durationSec,
      zoom: m.zoomLevel,
      inSec: m.zoomInMs / 1000,
      holdSec: m.zoomHoldMs / 1000,
      outSec: m.zoomOutMs / 1000,
    };
    const mode = cameraMode(m.zoomOnAction, m.livingCamera);
    const motionVf =
      mode === "living"
        ? cameraFilterExpr(recorder.events, {
            ...zoomShape,
            baseZoom: m.baseZoom,
            driftAmp: m.driftAmp,
            driftPeriodSec: m.driftPeriodSec,
          })
        : mode === "legacy"
          ? zoomFilterExpr(recorder.events, zoomShape)
          : undefined;

    await ffmpeg(
      framesEncodeArgs(join(framesDir, "frames.txt"), segPath, {
        width: config.resolution.width,
        height: config.resolution.height,
        fps: config.fps,
        motionVf,
      }),
    );
  } finally {
    // The mp4 is the artifact; the raw frames (potentially screenshots of an
    // authenticated app) do not stay at rest on ANY exit from this point on,
    // including a failed events-json write or a failed encode.
    await rm(framesDir, { recursive: true, force: true }).catch(() => {});
  }
  return segPath;
}

const MIN_SEGMENT_SEC = 0.1;

/** Dwell: pad remaining time to honour the declared shot duration. */
async function dwell(page: Page, durationSec: number, startMs: number): Promise<void> {
  const remainMs = Math.max(0, durationSec * 1000 - (Date.now() - startMs));
  if (remainMs > 0) await page.waitForTimeout(remainMs);
}

/**
 * Capture a single shot as a WebM video. Returns the absolute path to the .webm
 * (or, for prebaked, the supplied clip path).
 */
export async function captureShot(
  shot: Shot,
  timelineEntry: TimelineEntry,
  config: DemoConfig,
  outDir: string,
): Promise<string> {
  // A previous run's events artifact must never leak into this one: a shot
  // switched away from the screencast engine would otherwise feed the sound
  // stage obsolete click offsets from whatever run last wrote the file.
  await rm(join(outDir, `events_${shot.id}.json`), { force: true });

  // Short-circuit for prebaked clips — caller uses the existing file.
  if (shot.target === "prebaked") {
    if (!shot.clip) throw new Error(`prebaked shot ${shot.id} has no clip path`);
    return shot.clip;
  }

  await mkdir(outDir, { recursive: true });

  if (shot.target === "live") {
    return await captureLiveShot(shot, timelineEntry, config, outDir);
  }

  // dashboard/uipath/terminal — fresh headless context, no persisted state.
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  const useScreencast = config.capture.engine === "screencast";
  const context = await browser.newContext({
    viewport: config.resolution,
    ...(useScreencast ? {} : { recordVideo: { dir: outDir, size: config.resolution } }),
  });
  await context.addInitScript(overlayInitScript());
  if (config.captureCss) await context.addInitScript(cssInjectScript(config.captureCss));
  const page = await context.newPage();

  try {
    if (useScreencast) {
      const recorder: EventRecorder = { t0: 0, fallbackT0: 0, events: [] };
      return await recordWithScreencast(page, shot.id, config, outDir, recorder, async () => {
        const startMs = Date.now();
        await runActions(page, shot, config, undefined, recorder);
        await dwell(page, timelineEntry.durationSec, startMs);
      });
    }

    const startMs = Date.now();
    await runActions(page, shot, config);
    await dwell(page, timelineEntry.durationSec, startMs);

    const video = page.video();
    await context.close();
    await browser.close();
    if (!video) throw new Error(`no video recorded for shot ${shot.id}`);
    return await video.path();
  } finally {
    // Screencast path (and any failure) still releases the browser; the legacy
    // path above already closed it, making these no-ops.
    try { await context.close(); } catch { /* already closed */ }
    try { await browser.close(); } catch { /* already closed */ }
  }
}

/** Record a `live` shot against the saved auth profile (headless persistent context). */
async function captureLiveShot(
  shot: Shot,
  timelineEntry: TimelineEntry,
  config: DemoConfig,
  outDir: string,
): Promise<string> {
  const auth = config.capture.auth;
  if (!auth) throw new Error(`shot ${shot.id}: target "live" requires config.capture.auth (run "demo-video login <config>" first)`);
  const profileDir = resolveProfileDir(auth.profileDir, auth.loginUrl);
  if (!existsSync(profileDir)) {
    throw new Error(`shot ${shot.id}: no saved auth profile at ${profileDir} — run "demo-video login <config>" first`);
  }
  if (!auth.loggedInSelector) {
    // Fail closed by default: without a marker the record-time expiry guard cannot run,
    // so an expired session would be recorded silently. Require an explicit opt-in.
    if (!auth.allowUnguardedLiveCapture) {
      throw new Error(
        `shot ${shot.id}: target "live" needs capture.auth.loggedInSelector so the record-time ` +
          `session-expiry guard can fail closed. Set a loggedInSelector, or set ` +
          `capture.auth.allowUnguardedLiveCapture:true to record WITHOUT the guard (an expired session would be recorded).`,
      );
    }
    console.warn(
      `[agent-demo-video] shot "${shot.id}": recording live WITHOUT a session-expiry guard ` +
        `(allowUnguardedLiveCapture) — an expired session would be recorded.`,
    );
  }

  // A "live" shot MUST begin with a `goto`: each shot runs in a fresh persistent
  // context (blank initial page), and the session can only be verified after a
  // navigation. Requiring goto-first guarantees the auth guard runs before ANY
  // side-effecting action, with no unguarded click/type or no-goto path.
  if (shot.actions[0]?.kind !== "goto") {
    throw new Error(
      `shot ${shot.id}: a "live" shot must begin with a "goto" action so the session is verified before any other action runs.`,
    );
  }

  // Persistent context = the single-instance profile lock; capture is sequential
  // (pipeline records one shot at a time), so this never races a sibling.
  const useScreencast = config.capture.engine === "screencast";
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: config.resolution,
    ...(useScreencast ? {} : { recordVideo: { dir: outDir, size: config.resolution } }),
    headless: true,
  });
  try {
    await context.addInitScript(overlayInitScript());
    if (config.captureCss) await context.addInitScript(cssInjectScript(config.captureCss));
    const page = context.pages()[0] ?? (await context.newPage());

    // The first action is guaranteed to be a `goto` (validated above) and the guard runs
    // after EVERY navigation — so the expiry check fires before any click/type and a shot
    // that navigates more than once is re-checked on each goto. Never records or
    // side-effects against a logged-out page. Fails closed.
    const recorder: EventRecorder = { t0: 0, fallbackT0: 0, events: [] };
    const runShot = async () => {
      const startMs = Date.now();
      await runActions(
        page,
        shot,
        config,
        async () => {
          await assertAuthed(page, shot, auth.loggedInSelector);
        },
        recorder,
      );
      await dwell(page, timelineEntry.durationSec, startMs);
    };

    if (useScreencast) {
      const seg = await recordWithScreencast(page, shot.id, config, outDir, recorder, runShot);
      await context.close();
      return seg;
    }

    await runShot();
    const video = page.video();
    // Read the video path BEFORE close (close flushes/finalises the WebM).
    await context.close();
    if (!video) throw new Error(`no video recorded for shot ${shot.id}`);
    return await video.path();
  } catch (err) {
    // Ensure the persistent context is released on any failure (incl. the guard).
    try { await context.close(); } catch { /* already closing */ }
    throw err;
  }
}

/**
 * Fail-closed authentication check at record time. When a `loggedInSelector` is
 * configured, the authed marker MUST be visible after the shot's navigation; if it
 * is absent the session has expired (the app rendered the logged-out wall) and we
 * abort rather than ship a broken demo. Without a selector the check is skipped
 * (it cannot be done generically for an app we do not own).
 */
const AUTH_GUARD_TIMEOUT_MS = 10_000;

async function assertAuthed(page: Page, shot: Shot, loggedInSelector?: string): Promise<void> {
  if (!loggedInSelector) return;
  // Bounded WAIT, not an instant check: an authenticated SPA shell can still be
  // hydrating after `load`, so only declare the session expired once the marker has
  // failed to appear within the timeout (avoids false-positive expiry on slow apps).
  const visible = await page
    .waitForSelector(loggedInSelector, { state: "visible", timeout: AUTH_GUARD_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!visible) {
    throw new Error(
      `shot ${shot.id}: session appears expired — logged-in marker "${loggedInSelector}" not visible. ` +
        `Re-run "demo-video login <config>".`,
    );
  }
}

/**
 * Interactive login: open a HEADED persistent-context browser at the login URL, let
 * the operator authenticate (including MFA), and save the profile. The success edge
 * is, by default, the operator pressing Enter (authoritative for apps we do not own
 * and absorbs MFA/SSO with no special code). `confirmMode: "selector"|"auto"` instead
 * waits for the configured loggedInSelector (used for unattended/CI flows). NEVER a
 * bare URL regex. Returns the absolute profile directory.
 */
export async function captureLogin(config: DemoConfig): Promise<string> {
  const auth = config.capture.auth;
  if (!auth) throw new Error(`captureLogin: config.capture.auth is required`);
  const profileDir = resolveProfileDir(auth.profileDir, auth.loginUrl);
  await mkdir(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: config.resolution,
    headless: auth.headlessLogin,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(auth.loginUrl, { waitUntil: "load" });

    if (auth.confirmMode === "operator") {
      await awaitOperatorConfirm(auth.loginUrl);
    } else {
      if (!auth.loggedInSelector) {
        throw new Error(`captureLogin: confirmMode "${auth.confirmMode}" requires a loggedInSelector`);
      }
      await page.waitForSelector(auth.loggedInSelector, { state: "visible", timeout: auth.loginTimeoutMs });
      if (auth.confirmMode === "auto") await page.waitForTimeout(800);
    }
  } finally {
    // Close flushes the persisted profile (cookies/localStorage/IndexedDB) to disk.
    await context.close();
  }
  return profileDir;
}

/** Wait for the operator to press Enter on stdin (the authoritative login edge). */
function awaitOperatorConfirm(loginUrl: string): Promise<void> {
  return new Promise<void>((res, rej) => {
    // Fail closed on a non-interactive stdin instead of hanging the headed browser
    // forever (e.g. `demo-video login cfg < /dev/null` or any CI/non-TTY invocation).
    if (!process.stdin.isTTY) {
      rej(
        new Error(
          `captureLogin: confirmMode "operator" needs an interactive terminal, but stdin is not a TTY. ` +
            `Use confirmMode "selector" with a loggedInSelector for unattended login.`,
        ),
      );
      return;
    }
    process.stderr.write(
      `\n[agent-demo-video] A browser window opened at ${loginUrl}.\n` +
        `Log in (including any MFA), then press Enter here once you can see your workspace... `,
    );
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onErr);
      try { process.stdin.pause(); } catch { /* noop */ }
    };
    const onData = () => { cleanup(); res(); };
    const onEnd = () => { cleanup(); rej(new Error("captureLogin: stdin closed before login was confirmed")); };
    const onErr = (e: Error) => { cleanup(); rej(e); };
    try { process.stdin.resume(); } catch { /* noop */ }
    process.stdin.once("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onErr);
  });
}
