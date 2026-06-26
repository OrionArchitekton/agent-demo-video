import { describe, it, expect } from "vitest";
import { overlayInitScript, moveCursorExpr, clickExpr, chapterExpr, highlightExpr, cssInjectScript } from "./overlay";
describe("overlay", () => {
  it("init script defines the cursor + ripple + chapter API on window", () => {
    const s = overlayInitScript();
    expect(s).toContain("__demoCursor");
    expect(s).toContain("pointer-events: none");
    expect(s).toContain("__demoChapter");
    expect(s).toContain("__demoMove");
    expect(s).toContain("__demoClick");
    expect(s).toContain("__demoHighlight");
  });
  it("expression helpers reference the window API with args", () => {
    expect(moveCursorExpr(10, 20)).toContain("__demoMove(10, 20)");
    expect(clickExpr()).toContain("__demoClick()");
    expect(chapterExpr("Hello")).toContain('__demoChapter("Hello")');
    expect(highlightExpr("#x")).toContain('__demoHighlight("#x")');
  });
  it("cssInjectScript injects the given CSS via a deferred <style> element", () => {
    const s = cssInjectScript(".feed{max-height:200px}");
    expect(s).toContain("createElement('style')");
    expect(s).toContain(".feed{max-height:200px}");
    expect(s).toContain("DOMContentLoaded");
  });
  it("cssInjectScript JSON-escapes the CSS so quotes cannot break the script", () => {
    const s = cssInjectScript('.x::after{content:"hi"}');
    expect(s).toContain(JSON.stringify('.x::after{content:"hi"}'));
  });
});
