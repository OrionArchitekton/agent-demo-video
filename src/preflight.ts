import { lstatSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { cssInjectScript, overlayInitScript } from "./overlay.js";
import { waitForReady } from "./ready.js";
import { resolveUrl } from "./urls.js";
import { resolveClipPath } from "./clips.js";
import { redactUrl, redactUrlsInText, scrubControlChars } from "./sanitize.js";
import { SELECTOR_TIMEOUT_MS } from "./timeouts.js";
import { captureViewport } from "./platforms.js";
import { probeSizePx } from "./ffmpeg.js";
import { assertFullBleedCanvasAspect } from "./framing.js";
import type { Action, DemoConfig, Manifest, PreflightFinding, Shot } from "./types";

/** Action kinds that cannot run at all without a selector. */
const SELECTOR_REQUIRED: Action["kind"][] = ["click", "type", "hover", "highlight"];

/**
 * `hover` is the one selector action capture resolves NON-strictly
 * (`page.hover(selector)` defaults to strict:false and hovers the first match),
 * so an ambiguous hover renders fine today. The gate mirrors what the render
 * actually enforces rather than imposing a stricter rule of its own.
 */
const ambiguityIsFatal = (kind: Action["kind"]): boolean => kind !== "hover";

const isRegularNonSymlink = (path: string): boolean => {
  try {
    const entry = lstatSync(path);
    return entry.isFile() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
};

interface SelectorProbe {
  shot: Shot;
  kind: Action["kind"];
  selector: string;
  /** The URL in effect at this action's position, already resolved. */
  url: string;
  /**
   * True when a click or type ran earlier in this shot since the last
   * navigation. The gate deliberately runs NO actions, so anything downstream
   * of an interaction is UNKNOWN to it rather than absent.
   */
  afterInteraction: boolean;
}

/**
 * Walk a shot's actions in order, tracking the page in effect and whether the
 * DOM has been interacted with, so every selector is judged in its own context.
 *
 * A shot may navigate more than once (`runActions` executes every goto), so
 * resolving all of a shot's selectors against its FIRST goto counts later ones
 * against the wrong page: fail-open when the name happens to exist on page one,
 * false-blocking when it does not.
 */
function selectorProbes(shot: Shot, config: DemoConfig): SelectorProbe[] {
  const probes: SelectorProbe[] = [];
  // openShotPage hoists the FIRST goto and performs it before the action loop,
  // so a selector action declared ahead of that goto still runs against its
  // page. Skipping those would leave them silently unprobed.
  const firstGoto = shot.actions.find((a) => a.kind === "goto");
  const firstUrl = firstGoto ? resolveUrl(firstGoto.url ?? "/", config.dashboardBaseUrl) : undefined;
  let url: string | undefined = firstUrl;
  let interacted = false;
  for (const a of shot.actions) {
    if (a.kind === "goto") {
      url = resolveUrl(a.url ?? "/", config.dashboardBaseUrl);
      interacted = false; // a navigation rebuilds the DOM
      continue;
    }
    if (a.selector && url) {
      probes.push({ shot, kind: a.kind, selector: a.selector, url, afterInteraction: interacted });
    }
    // hover opens submenus and tooltips, so it reveals DOM exactly as a click does.
    if (a.kind === "click" || a.kind === "type" || a.kind === "hover") interacted = true;
  }
  return probes;
}

/**
 * Findings decidable without a browser.
 *
 * Each is something a render would otherwise discover only after every
 * narration has already been paid for.
 */
export function structuralFindings(manifest: Manifest, config: DemoConfig): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const shot of manifest.shots) {
    // An action that cannot run without a selector, declared without one, is
    // invisible to selector resolution (there is nothing to resolve) and throws
    // at capture after all TTS spend.
    for (const a of shot.actions) {
      if (SELECTOR_REQUIRED.includes(a.kind) && !a.selector) {
        findings.push({
          shotId: shot.id,
          kind: "missing-selector",
          severity: "blocking",
          message: `shot "${shot.id}": ${a.kind} action declares no selector; capture requires one and would throw mid-render`,
        });
      }
    }

    if (shot.target === "prebaked") {
      // Decidable here, so it costs nothing. A one-character typo in `clip:`
      // otherwise synthesizes every narration first and fails at capture.
      if (!shot.clip) {
        // Just as decidable as a declared-but-absent clip, and capture throws on
        // it either way; it previously slipped through this guard entirely.
        findings.push({
          shotId: shot.id,
          kind: "missing-clip",
          severity: "blocking",
          message: `shot "${shot.id}" is prebaked but declares no clip; capture has nothing to splice in`,
        });
      } else {
        const clipPath = resolveClipPath(shot.clip, config.clipsDir, config.configDir ?? process.cwd());
        if (!isRegularNonSymlink(clipPath)) {
          findings.push({
            shotId: shot.id,
            kind: "missing-clip",
            severity: "blocking",
            message:
              `shot "${shot.id}": prebaked clip not found at ${clipPath} ` +
              `(clip: ${JSON.stringify(shot.clip)}, clipsDir: ${JSON.stringify(config.clipsDir)})`,
          });
        }
      }
      // A prebaked shot short-circuits before runActions, so its selector
      // actions are dead declarations: they read as instructions and do
      // nothing. Never a no-navigation finding, since it is not meant to navigate.
      const dead = shot.actions.filter((a) => a.selector).length;
      if (dead > 0) {
        findings.push({
          shotId: shot.id,
          kind: "prebaked-actions",
          severity: "blocking",
          message:
            `shot "${shot.id}" is prebaked but declares ${dead} selector action(s); ` +
            "capture returns the clip without opening a browser, so these actions never run",
        });
      }
      continue;
    }

    const selectors = shot.actions.filter((a) => a.selector).length;
    if (selectors > 0 && !shot.actions.some((a) => a.kind === "goto")) {
      findings.push({
        shotId: shot.id,
        kind: "no-navigation",
        severity: "blocking",
        message:
          `shot "${shot.id}" uses ${selectors} selector(s) but declares no goto action; ` +
          "capture builds a fresh context per shot, so this shot runs against about:blank " +
          "and every locator waits out its full timeout",
      });
    }
  }
  return findings;
}

/**
 * Probe finished full-bleed compositions before narration spend. Merely
 * finding the file is insufficient: normalize preserves aspect and pads, so a
 * landscape mistake can otherwise become a formally valid portrait file with
 * hidden bars.
 */
async function clipGeometryFindings(
  manifest: Manifest,
  config: DemoConfig,
): Promise<PreflightFinding[]> {
  const findings: PreflightFinding[] = [];
  for (const shot of manifest.shots) {
    if (shot.target !== "prebaked" || !shot.fullBleed || !shot.clip) continue;
    const clipPath = resolveClipPath(shot.clip, config.clipsDir, config.configDir ?? process.cwd());
    if (!isRegularNonSymlink(clipPath)) continue;
    try {
      assertFullBleedCanvasAspect(config.resolution, await probeSizePx(clipPath), shot.id);
    } catch (error) {
      findings.push({
        shotId: shot.id,
        kind: "invalid-clip-geometry",
        severity: "blocking",
        message:
          error instanceof Error
            ? error.message
            : `shot "${shot.id}": could not verify fullBleed clip geometry`,
      });
    }
  }
  return findings;
}

/**
 * Count matches the way the RENDER counts them.
 *
 * `page.locator()` is Playwright's engine: it pierces open shadow roots and
 * accepts `>> nth=`, `text=`, `:has-text()` and xpath, none of which
 * `document.querySelectorAll` understands. Counting with querySelectorAll made
 * the gate a second, divergent definition of "resolves" and rejected selectors
 * that render correctly today (this repo's own `demos/proctor` ships
 * `.toggle-btn >> nth=1`). -1 means genuinely unparseable.
 */
async function countMatches(page: Page, selector: string): Promise<number> {
  try {
    return await page.locator(selector).count();
  } catch {
    return -1;
  }
}

/**
 * Resolve every shot's selectors against the page that shot opens at that point.
 *
 * A selector is good only when it resolves to exactly one element. Zero is a
 * silent no-op in the overlay; more than one means the strict locator throws at
 * render (except `hover`, which is non-strict).
 *
 * The gate runs NO actions: driving clicks and typing against a real app before
 * a render would mutate the very app being demoed. So anything an interaction
 * could have revealed is reported as unverifiable rather than failed.
 */
export async function resolveSelectorFindings(
  manifest: Manifest,
  config: DemoConfig,
): Promise<PreflightFinding[]> {
  const findings: PreflightFinding[] = [];
  const byUrl = new Map<string, SelectorProbe[]>();

  for (const shot of manifest.shots) {
    if (shot.target === "prebaked") continue; // structural findings own these
    if (!shot.actions.some((a) => a.selector)) continue;
    // A live shot drives a saved auth profile. Resolving it with this gate's own
    // unauthenticated context would hit the login wall and report every selector
    // as a zero-match, so a fail-closed gate would block a correct script.
    if (shot.target === "live") {
      findings.push({
        shotId: shot.id,
        kind: "unverified",
        severity: "info",
        message:
          `shot "${shot.id}" is a live (auth-walled) shot: its selectors were NOT resolved, ` +
          "because this gate runs unauthenticated and would see the login wall",
      });
      continue;
    }
    for (const probe of selectorProbes(shot, config)) {
      const bucket = byUrl.get(probe.url);
      if (bucket) bucket.push(probe);
      else byUrl.set(probe.url, [probe]);
    }
  }

  if (byUrl.size === 0) return findings;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  try {
    for (const [url, probes] of byUrl) {
      // A FRESH context per page, matching capture's fresh-context-per-shot.
      // One shared context would accumulate cookies and storage, so a
      // first-visit banner would be present for the first URL and gone after,
      // making the gate's verdict depend on the ORDER shots are declared in.
      // Resolve selectors at the SAME viewport the capture will use (viewport
      // space, not the output canvas) so responsive layouts match the render.
      const context = await browser.newContext({ viewport: captureViewport(config) });
      // The captured page carries these, and they add elements: the overlay
      // appends four divs to document.body. Without them a `div` selector can
      // count 1 here and 5 at render.
      await context.addInitScript(overlayInitScript());
      if (config.captureCss) await context.addInitScript(cssInjectScript(config.captureCss));
      const page = await context.newPage();
      const safe = redactUrl(url);
      try {
        let response;
        try {
          response = await page.goto(url, { waitUntil: "load" });
        } catch (e) {
          // The gate is the first thing that touches the network, so a dev
          // server that is not up yet would otherwise surface as a raw
          // Playwright error naming no shot and never mentioning preflight.
          findings.push({
            shotId: probes[0]!.shot.id,
            kind: "unreachable",
            severity: "blocking",
            message:
              `could not open ${safe} (${redactUrlsInText(scrubControlChars((e as Error).message, 160))}); ` +
              `${probes.length} selector(s) could not be checked`,
          });
          continue;
        }
        // A dev server that serves a 404 page for a bad route would otherwise
        // produce one "selector matches nothing" per selector, pointing the
        // operator at the script instead of at the route.
        if (response && !response.ok()) {
          findings.push({
            shotId: probes[0]!.shot.id,
            kind: "unreachable",
            severity: "blocking",
            message: `${safe} returned HTTP ${response.status()}; ${probes.length} selector(s) could not be checked against the real page`,
          });
          continue;
        }
        // waitForReady FAILS OPEN by construction (see ready.ts): it never
        // rejects. Dropping its result would let the gate count selectors on a
        // pre-hydration skeleton and report that as verified.
        const settle = await waitForReady(page, config.capture.settleMs);
        if (settle.warning) {
          findings.push({
            shotId: probes[0]!.shot.id,
            kind: "unverified",
            severity: "info",
            message: `${safe} did not settle before selectors were counted (${redactUrlsInText(scrubControlChars(settle.warning, 160))}); counts below may not reflect the rendered DOM`,
          });
        }

        // Once ONE selector on this page has waited out the full budget, the page
        // is demonstrably done arriving, so later absences need no further wait.
        // Without this, K typo'd selectors cost K * preflightWaitMs serially
        // (10 typos at the default budget is five minutes before the run is
        // refused), which punishes exactly the badly-broken script this gate is
        // meant to reject cheaply.
        let pageSettledByExhaustedWait = false;
        for (const probe of probes) {
          let matches = await countMatches(page, probe.selector);
          // The render's locator AUTO-WAITS; counting once, instantly, is
          // stricter than the render and would false-block an element that
          // hydrates in after load.
          // `> 0` is load-bearing: Playwright reads `timeout: 0` as WAIT FOREVER,
          // so passing a zero budget through would hang the gate indefinitely.
          // Matching `capture.settleMs`, 0 here means the wait is disabled.
          if (matches === 0 && !probe.afterInteraction && !pageSettledByExhaustedWait && config.preflightWaitMs > 0) {
            await page
              .locator(probe.selector)
              .first()
              .waitFor({ state: "attached", timeout: config.preflightWaitMs })
              .catch(() => {
                pageSettledByExhaustedWait = true;
              });
            matches = await countMatches(page, probe.selector);
          }
          if (matches === 1) continue;

          const where = `shot "${probe.shot.id}": selector ${JSON.stringify(probe.selector)}`;
          if (matches < 0) {
            findings.push({
              shotId: probe.shot.id,
              kind: "invalid-selector",
              severity: "blocking",
              selector: probe.selector,
              message: `${where} is not a selector Playwright can parse`,
            });
            continue;
          }
          // Two reasons the gate must not block on a real difference it cannot
          // adjudicate: it ran no actions, and hover is non-strict at render.
          const unverifiable = probe.afterInteraction;
          // Absence only counts against the script when the gate waited at least
          // as long as the render will. A shortened budget means the element may
          // simply not have arrived yet, which is our limitation, not a defect.
          const waitedAsLongAsRender = config.preflightWaitMs >= SELECTOR_TIMEOUT_MS;
          const impatient = matches === 0 && !waitedAsLongAsRender;
          const fatal = unverifiable || impatient ? false : matches === 0 ? true : ambiguityIsFatal(probe.kind);
          const because = unverifiable
            ? " (an earlier click or type in this shot can change the DOM, and the gate runs no actions, so this could not be verified)"
            : impatient
              ? ` (the gate's ${config.preflightWaitMs}ms wait budget is shorter than the render's ${SELECTOR_TIMEOUT_MS}ms, so this is reported rather than blocking)`
            : probe.kind === "hover" && matches > 1
              ? " (hover resolves non-strictly at render, so this is reported rather than blocking)"
              : "";
          findings.push({
            shotId: probe.shot.id,
            kind: matches === 0 ? "no-match" : "ambiguous",
            severity: fatal ? "blocking" : "info",
            selector: probe.selector,
            matches,
            message:
              matches === 0
                ? `${where} matches nothing on ${safe}${because}`
                : `${where} is ambiguous, ${matches} matches on ${safe} (the strict locator needs exactly one)${because}`,
          });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return findings;
}

/**
 * The full gate: structural findings (no browser) plus selector resolution
 * against the page each shot opens. Structural findings come first because a
 * shot that never navigates cannot be resolved at all, and the author needs to
 * see both classes in one pass rather than one render at a time.
 */
export async function runPreflight(manifest: Manifest, config: DemoConfig): Promise<PreflightFinding[]> {
  return [
    ...structuralFindings(manifest, config),
    ...(await clipGeometryFindings(manifest, config)),
    ...(await resolveSelectorFindings(manifest, config)),
  ];
}

/** Render findings as operator-readable lines, severity first so a scan sorts itself. */
export function formatPreflightReport(findings: PreflightFinding[]): string {
  return findings.map((f) => `  ${f.severity === "blocking" ? "BLOCKING" : "INFO    "}  ${f.message}`).join("\n");
}
