import { describe, it, expect } from "vitest";
import { titleCardArgs, endCardArgs, wrapHook, hookLayout } from "./cards";

const O = {
  width: 1920, height: 1080, fps: 30, durationSec: 2.2, font: "Arial",
  backdropTop: "#101418", backdropBottom: "#1d2733", accent: "#3fb950",
  title: "Standing Questions", subtitle: "Ask once. It keeps watching.", url: "standing-questions.vercel.app",
};

describe("text safety", () => {
  it("references text via textfile= and never inlines operator text into the filtergraph", () => {
    const j = titleCardArgs({ ...O, title: "Dan's 100%: Demo" }, "/t/title.mp4", { titleFile: "/t/c_t.txt", subtitleFile: "/t/c_s.txt" }).join(" ");
    expect(j).toContain("textfile=/t/c_t.txt");
    expect(j).not.toContain("Dan's");
  });
})

describe("cards", () => {
  it("title card renders gradient + title + subtitle with fades at the requested duration", () => {
    const j = titleCardArgs(O, "/t/title.mp4", { titleFile: "/t/c_t.txt", subtitleFile: "/t/c_s.txt" }).join(" ");
    expect(j).toContain("gradients=");
    expect(j).toContain("drawtext");
    expect(j).toContain("textfile=");
    expect(j).toContain("fade=t=in");
    expect(j).toContain("fade=t=out");
    expect(j).toContain("2.2");
    expect(j).toContain("-an");
  });
  it("end card carries the url in the accent color", () => {
    const j = endCardArgs(O, "/t/end.mp4", { titleFile: "/t/c_t.txt", urlFile: "/t/c_u.txt" }).join(" ");
    expect(j).toContain("textfile=/t/c_u.txt");
    expect(j.toLowerCase()).toContain("3fb950");
  });
});

describe("textfile path safety (pipeline finding)", () => {
  it("escapes filtergraph metacharacters in textfile paths", () => {
    const j = titleCardArgs(O, "/t/title.mp4", { titleFile: "/we:ird/pa'th/c_t.txt" }).join(" ");
    expect(j).toContain("textfile=/we\\:ird/pa\\\\\\'th/c_t.txt");
  });
});

describe("drawtext literal expansion (pipeline finding)", () => {
  it("every drawtext disables expansion so % in operator text stays literal", () => {
    const t = titleCardArgs(O, "/t/title.mp4", { titleFile: "/t/c_t.txt", subtitleFile: "/t/c_s.txt" });
    const e = endCardArgs(O, "/t/end.mp4", { titleFile: "/t/c_t.txt", urlFile: "/t/c_u.txt" });
    for (const args of [t, e]) {
      const vf = args[args.indexOf("-vf") + 1]!;
      const drawtexts = vf.split(",").filter((f) => f.startsWith("drawtext"));
      expect(drawtexts.length).toBeGreaterThan(0);
      for (const d of drawtexts) expect(d).toContain("expansion=none");
    }
  });
});

describe("textfile graph-separator safety (pipeline finding)", () => {
  it("escapes comma, semicolon, and brackets in textfile paths", () => {
    const j = titleCardArgs(O, "/t/title.mp4", { titleFile: "/a,b;c[d]/c_t.txt" }).join(" ");
    expect(j).toContain("textfile=/a\\,b\\;c\\[d\\]/c_t.txt");
  });
});

describe("wrapHook", () => {
  it("wraps on word boundaries within the width", () => {
    expect(wrapHook("Stop pasting client secrets into AI chats", 14)).toEqual(["Stop pasting", "client secrets", "into AI chats"]);
  });
  it("keeps a single over-long word on its own line", () => {
    expect(wrapHook("Supercalifragilistic now", 10)).toEqual(["Supercalifragilistic", "now"]);
  });
});
describe("hookLayout", () => {
  it("sizes the hook larger than the product title and fits the canvas width", () => {
    const l = hookLayout(1080, 1920, "Stop pasting client secrets into AI chats");
    expect(l.fontSize).toBeGreaterThan(Math.round(1920 * 0.034));
    expect(Math.max(...l.lines.map((s) => s.length)) * l.fontSize * 0.55).toBeLessThanOrEqual(1080 * 0.9);
  });
});
describe("titleCardArgs with a hook", () => {
  const P = { ...O, width: 1080, height: 1920, hook: "Stop pasting secrets" };
  it("draws the hook from its textfile, larger than the title", () => {
    const j = titleCardArgs(P, "/t/title.mp4", { titleFile: "/t/c_t.txt", hookFile: "/t/c_h.txt" }).join(" ");
    expect(j).toContain("textfile=/t/c_h.txt");
    const sizes = (j.match(/fontsize=(\d+)/g) ?? []).map((m) => Number(m.slice(9)));
    const hookSize = Number(/c_h\.txt:fontsize=(\d+)/.exec(j)![1]);
    const titleSize = Number(/c_t\.txt:fontsize=(\d+)/.exec(j)![1]);
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    expect(titleSize).toBeLessThan(hookSize);
  });
  it("without a hook file the filtergraph is unchanged", () => {
    const a = titleCardArgs(O, "/t/title.mp4", { titleFile: "/t/c_t.txt", subtitleFile: "/t/c_s.txt" });
    const b = titleCardArgs({ ...O, hook: "x" }, "/t/title.mp4", { titleFile: "/t/c_t.txt", subtitleFile: "/t/c_s.txt" });
    expect(b).toEqual(a);
  });
});
