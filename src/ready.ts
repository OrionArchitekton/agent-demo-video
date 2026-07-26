import type { Page } from "playwright";

export type ReadyResult = { ready: boolean; warning?: string };

/**
 * In-page readiness probe. Resolves once web fonts have settled and every
 * in-viewport image has both loaded AND decoded.
 *
 * `waitUntil: "load"` alone does not cover font swap, lazy images, SPA
 * hydration, or XHR-driven data, which is the profile of the dashboards this
 * pipeline targets: `load` can fire on a page that is still visually blank.
 */
const PROBE = `(async () => {
  const imgs = Array.from(document.images).filter((i) => {
    const r = i.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
  });
  await Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ...imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())),
  ]);
  return { fonts: true, images: imgs.length, pending: 0 };
})()`;

/**
 * Wait for the page to be visually settled, bounded by `budgetMs`.
 *
 * Fails OPEN by construction: a page that never settles, or a probe that
 * throws, yields `ready: false` plus a warning for the run report. It never
 * rejects, because aborting here would discard an already-paid render over a
 * slow page. The caller records the warning; it does not gate on it.
 */
export async function waitForReady(page: Page, budgetMs: number): Promise<ReadyResult> {
  if (budgetMs <= 0) return { ready: false, warning: "settle budget is zero; readiness not probed" };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReadyResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ready: false, warning: `page did not settle within the ${budgetMs}ms settle budget` }),
      budgetMs,
    );
  });

  try {
    return await Promise.race([
      page.evaluate(PROBE).then(() => ({ ready: true }) as ReadyResult),
      timeout,
    ]);
  } catch (e) {
    return { ready: false, warning: `readiness probe failed: ${(e as Error).message}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
