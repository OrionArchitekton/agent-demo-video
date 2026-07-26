/**
 * timeouts.ts — the one place the capture path's selector budget is written down.
 *
 * Pure module: no imports. `captureShot` resolves selectors through Playwright
 * locators, which auto-wait. Leaving that budget implicit (Playwright's default)
 * meant the pre-flight gate had no way to know how patient the render is, and a
 * gate that waits LESS than the render will fail a selector the render would
 * have found: a fail-closed gate refusing a script that works.
 *
 * Both sides import this, and capture passes it explicitly rather than relying
 * on the library default, so the two cannot drift apart silently.
 */
export const SELECTOR_TIMEOUT_MS = 30_000;
