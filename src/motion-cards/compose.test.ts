import { describe, it, expect } from "vitest";
import { escapeHtml, titleCardHtml, endCardHtml } from "./compose";

const base = { width: 1080, height: 1920, fps: 30, durationSec: 2.2, font: "Arial", backdropTop: "#101418", backdropBottom: "#1d2733", accent: "#3fb950", title: "Demo <b>&</b> \"Co\"" };

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml(`<script>alert('x')</script> & "q"`)).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;q&quot;");
  });
});

describe("titleCardHtml", () => {
  it("declares the composition geometry, fps and duration", () => {
    const html = titleCardHtml(base);
    expect(html).toContain('data-composition-id="main"');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
    expect(html).toContain('data-fps="30"');
    expect(html).toContain('data-duration="2.2"');
  });
  it("marks the CSS-only composition root with data-no-timeline", () => {
    const html = titleCardHtml(base);
    const root = html.match(/<div id="root"[^>]*>/)?.[0] ?? "";
    expect(root).toContain("data-no-timeline");
    expect(endCardHtml({ ...base, url: "x.com" }).match(/<div id="root"[^>]*>/)?.[0]).toContain("data-no-timeline");
  });
  it("never emits author text as markup", () => {
    const html = titleCardHtml({ ...base, subtitle: "<img src=x onerror=alert(1)>", hook: "Stop <pasting>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<pasting>");
    expect(html).toContain("Demo &lt;b&gt;&amp;&lt;/b&gt; &quot;Co&quot;");
  });
  it("shows the hook at full opacity from the first frame", () => {
    const html = titleCardHtml({ ...base, hook: "Stop pasting secrets" });
    const hookRule = html.match(/#hook\s*\{[^}]*\}/)?.[0] ?? "";
    expect(hookRule).not.toMatch(/opacity:\s*0[;\s]/);
    expect(html).toMatch(/@keyframes settle\s*\{\s*from\s*\{[^}]*scale\(1\.0[1-9]\)/);
    expect(html).not.toMatch(/@keyframes settle[^}]*opacity:\s*0/);
  });
  it("reveals the product name after the hook when a hook is set", () => {
    const html = titleCardHtml({ ...base, hook: "Stop pasting secrets" });
    expect(html).toMatch(/#title\s*\{[^}]*opacity:\s*0/);
    expect(html).toMatch(/#title\s*\{[^}]*animation:[^;]*reveal/);
  });
  it("uses the configured colors and font", () => {
    const html = titleCardHtml(base);
    expect(html).toContain("#101418");
    expect(html).toContain("#1d2733");
    expect(html).toContain("#3fb950");
    expect(html).toContain("Arial");
  });
  it("rejects colors that are not hex", () => {
    for (const bad of ["red", "#12", "#zzzzzz", "#fff; background:url(x)", "#fff}</style>"]) {
      expect(() => titleCardHtml({ ...base, accent: bad })).toThrow();
      expect(() => titleCardHtml({ ...base, backdropTop: bad })).toThrow();
      expect(() => titleCardHtml({ ...base, backdropBottom: bad })).toThrow();
    }
  });
  it("rejects font names that could break out of a CSS string", () => {
    for (const bad of ['Ar"ial', "Ar'ial", "Ar\\ial", "Arial;color:red", "Ar{ial", "Ar}ial", "Ar<ial", "Ar>ial", "Ar\nial"]) {
      expect(() => titleCardHtml({ ...base, font: bad })).toThrow();
      expect(() => endCardHtml({ ...base, font: bad, url: "x.com" })).toThrow();
    }
  });
});

describe("endCardHtml", () => {
  it("reveals the URL and fades the title in", () => {
    const html = endCardHtml({ ...base, url: "example.com/demo" });
    expect(html).toContain("example.com/demo");
    expect(html).toMatch(/#url\s*\{[^}]*animation:[^;]*reveal/);
  });
});
