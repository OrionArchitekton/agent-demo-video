/**
 * capture.ts — Playwright recordVideo capture driver
 *
 * Launches a headless Chromium context with video recording enabled,
 * executes the shot's action sequence, pads to the declared duration,
 * and returns the path to the recorded WebM file.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import {
  overlayInitScript,
  moveCursorExpr,
  clickExpr,
  chapterExpr,
  highlightExpr,
} from "./overlay.js";
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
 * Capture a single shot as a WebM video.
 *
 * @param shot           The shot descriptor (actions, id, target, etc.)
 * @param timelineEntry  Timing info (durationSec used for dwell padding)
 * @param config         Global demo configuration (resolution, dashboardBaseUrl)
 * @param outDir         Directory to write the video into
 * @returns              Absolute path to the recorded .webm file
 */
export async function captureShot(
  shot: Shot,
  timelineEntry: TimelineEntry,
  config: DemoConfig,
  outDir: string,
): Promise<string> {
  // Short-circuit for prebaked clips — caller uses the existing file.
  if (shot.target === "prebaked") {
    if (!shot.clip) {
      throw new Error(`prebaked shot ${shot.id} has no clip path`);
    }
    return shot.clip;
  }

  await mkdir(outDir, { recursive: true });

  // Launch browser: try bundled Chromium first, fall back to system Chrome.
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
  const page = await context.newPage();

  const startMs = Date.now();

  for (const a of shot.actions) {
    switch (a.kind) {
      case "goto":
        await page.goto(resolveUrl(a.url ?? "/", config.dashboardBaseUrl), {
          waitUntil: "load",
        });
        break;

      case "chapter":
        await page.evaluate(chapterExpr(a.label ?? a.text ?? ""));
        await page.waitForTimeout(800);
        break;

      case "click": {
        if (!a.selector) {
          throw new Error(`shot ${shot.id}: click action missing selector`);
        }
        const box = await page.locator(a.selector).boundingBox();
        if (!box) {
          throw new Error(
            `shot ${shot.id}: selector not found or has no bounding box: ${a.selector}`,
          );
        }
        const cx = Math.round(box.x + box.width / 2);
        const cy = Math.round(box.y + box.height / 2);
        await page.evaluate(moveCursorExpr(cx, cy));
        await page.waitForTimeout(300);
        await page.evaluate(clickExpr());
        await page.click(a.selector);
        break;
      }

      case "type":
        if (!a.selector) {
          throw new Error(`shot ${shot.id}: type action missing selector`);
        }
        await page
          .locator(a.selector)
          .pressSequentially(a.text ?? "", { delay: 60 });
        break;

      case "hover":
        if (!a.selector) {
          throw new Error(`shot ${shot.id}: hover action missing selector`);
        }
        await page.hover(a.selector);
        break;

      case "highlight":
        if (!a.selector) {
          throw new Error(`shot ${shot.id}: highlight action missing selector`);
        }
        await page.evaluate(highlightExpr(a.selector));
        break;

      case "wait":
        await page.waitForTimeout(a.ms ?? 500);
        break;

      default: {
        // Exhaustiveness guard — TypeScript will catch unknown kinds at compile time.
        const _never: never = a.kind;
        throw new Error(`shot ${shot.id}: unknown action kind: ${_never}`);
      }
    }
  }

  // Dwell: pad remaining time to honour the declared shot duration.
  const elapsedMs = Date.now() - startMs;
  const remainMs = Math.max(0, timelineEntry.durationSec * 1000 - elapsedMs);
  if (remainMs > 0) {
    await page.waitForTimeout(remainMs);
  }

  // Capture the video reference BEFORE closing (closing flushes/finalises the WebM).
  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) {
    throw new Error(`no video recorded for shot ${shot.id}`);
  }

  return await video.path();
}
