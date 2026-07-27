import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { highlightExpr, overlayInitScript } from "../src/overlay";

/**
 * The overlay API is exercised in a REAL page rather than asserted against the
 * emitted source. A `toContain("querySelectorAll")` string test passes whether
 * or not the function actually raises, which is the same "green means nothing"
 * failure this whole change is about.
 */
describe("overlay __demoHighlight (smoke)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(overlayInitScript());
    page = await context.newPage();
    await page.goto(pathToFileURL(resolve("tests/fixtures/page.html")).href, { waitUntil: "load" });
  }, 60_000);

  afterAll(async () => { await browser?.close(); });

  it("highlights a selector that resolves to exactly one element", async () => {
    await expect(page.evaluate(highlightExpr("#bootstrap"))).resolves.toBeUndefined();
  });

  // The fail-open case that started this: hiding the box and returning means the
  // shot renders, the run exits 0, and the highlight simply never happened.
  it("raises instead of silently hiding the box when nothing matches", async () => {
    await expect(page.evaluate(highlightExpr("#definitely-not-here"))).rejects.toThrow(/matched 0 elements/);
  });

  // document.querySelector silently takes the FIRST match, so an ambiguous
  // selector is indistinguishable from a correct one until you inspect frames.
  it("raises on an ambiguous selector rather than taking the first match", async () => {
    await expect(page.evaluate(highlightExpr("button"))).rejects.toThrow(/matched 2 elements/);
  });
});
