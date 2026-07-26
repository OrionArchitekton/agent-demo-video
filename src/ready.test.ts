import { describe, it, expect } from "vitest";
import { waitForReady } from "./ready";

/**
 * A shot that navigates and starts recording before the page has painted ships
 * an all-white segment. That has happened in a REAL render while every keyless
 * smoke run of the same script was clean, because capture timing differs run to
 * run. The settle gate makes readiness a property of the pipeline instead of
 * something each script author has to remember to hand-author as `wait ms=`.
 *
 * It must fail OPEN: a slow page is a warning, never an aborted paid render.
 */
describe("waitForReady", () => {
  it("returns no warning once the page reports fonts ready and images decoded", async () => {
    const page = { evaluate: async () => ({ fonts: true, images: 3, pending: 0 }) };
    const res = await waitForReady(page as never, 500);
    expect(res.ready).toBe(true);
    expect(res.warning).toBeUndefined();
  });

  it("fails OPEN with a warning when the page never settles within the budget", async () => {
    const page = { evaluate: () => new Promise(() => {}) }; // never resolves
    const started = Date.now();
    const res = await waitForReady(page as never, 120);
    expect(res.ready).toBe(false);
    expect(res.warning).toMatch(/settle/i);
    expect(Date.now() - started).toBeLessThan(2000); // bounded, did not hang
  });

  it("fails OPEN with a warning when readiness probing throws", async () => {
    const page = { evaluate: async () => { throw new Error("execution context destroyed"); } };
    const res = await waitForReady(page as never, 500);
    expect(res.ready).toBe(false);
    expect(res.warning).toMatch(/execution context destroyed/);
  });
});
