import { describe, it, expect } from "vitest";
import { overlayInitScript, moveCursorExpr, clickExpr, chapterExpr, highlightExpr } from "./overlay";
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
});
