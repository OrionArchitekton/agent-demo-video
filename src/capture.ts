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
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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
): Promise<void> {
  for (const a of shot.actions) {
    switch (a.kind) {
      case "goto":
        await page.goto(resolveUrl(a.url ?? "/", config.dashboardBaseUrl), { waitUntil: "load" });
        if (onGoto) await onGoto();
        break;
      case "chapter":
        await page.evaluate(chapterExpr(a.label ?? a.text ?? ""));
        await page.waitForTimeout(800);
        break;
      case "click": {
        if (!a.selector) throw new Error(`shot ${shot.id}: click action missing selector`);
        const box = await page.locator(a.selector).boundingBox();
        if (!box) throw new Error(`shot ${shot.id}: selector not found or has no bounding box: ${a.selector}`);
        const cx = Math.round(box.x + box.width / 2);
        const cy = Math.round(box.y + box.height / 2);
        await page.evaluate(moveCursorExpr(cx, cy));
        await page.waitForTimeout(300);
        await page.evaluate(clickExpr());
        await page.click(a.selector);
        break;
      }
      case "type":
        if (!a.selector) throw new Error(`shot ${shot.id}: type action missing selector`);
        await page.locator(a.selector).pressSequentially(a.text ?? "", { delay: 60 });
        break;
      case "hover":
        if (!a.selector) throw new Error(`shot ${shot.id}: hover action missing selector`);
        await page.hover(a.selector);
        break;
      case "highlight":
        if (!a.selector) throw new Error(`shot ${shot.id}: highlight action missing selector`);
        await page.evaluate(highlightExpr(a.selector));
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
  const context = await browser.newContext({
    viewport: config.resolution,
    recordVideo: { dir: outDir, size: config.resolution },
  });
  await context.addInitScript(overlayInitScript());
  if (config.captureCss) await context.addInitScript(cssInjectScript(config.captureCss));
  const page = await context.newPage();

  const startMs = Date.now();
  await runActions(page, shot, config);
  await dwell(page, timelineEntry.durationSec, startMs);

  const video = page.video();
  await context.close();
  await browser.close();
  if (!video) throw new Error(`no video recorded for shot ${shot.id}`);
  return await video.path();
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
  const context = await chromium.launchPersistentContext(profileDir, {
    viewport: config.resolution,
    recordVideo: { dir: outDir, size: config.resolution },
    headless: true,
  });
  try {
    await context.addInitScript(overlayInitScript());
    if (config.captureCss) await context.addInitScript(cssInjectScript(config.captureCss));
    const page = context.pages()[0] ?? (await context.newPage());

    const startMs = Date.now();
    // The first action is guaranteed to be a `goto` (validated above) and the guard runs
    // after EVERY navigation — so the expiry check fires before any click/type and a shot
    // that navigates more than once is re-checked on each goto. Never records or
    // side-effects against a logged-out page. Fails closed.
    await runActions(page, shot, config, async () => {
      await assertAuthed(page, shot, auth.loggedInSelector);
    });
    await dwell(page, timelineEntry.durationSec, startMs);

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
