import { describe, it, expect } from "vitest";
import { titleCardArgs, endCardArgs, wrapHook, hookLayout, estimateTextWidth } from "./cards";

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
describe("hookLayout fit guarantee", () => {
  const base = Math.round(1920 * 0.075);
  it("fits an all-caps hook inside 90% of the width", () => {
    const l = hookLayout(1080, 1920, "STOP PASTING SECRETS INTO AI NOW");
    for (const line of l.lines) expect(estimateTextWidth(line, l.fontSize)).toBeLessThanOrEqual(0.9 * 1080);
  });
  it("shrinks for an over-long word, down to at most the floor", () => {
    const l = hookLayout(1080, 1920, "Supercalifragilisticexpialidocious AI");
    expect(l.fontSize).toBeLessThan(base);
    const w = estimateTextWidth("Supercalifragilisticexpialidocious", l.fontSize);
    expect(w <= 0.9 * 1080 || l.fontSize === Math.round(1920 * 0.035)).toBe(true);
  });
  const ABCDE = "ABCDE ABCDE ABCDE ABCDE ABCDE ABCDE ABCDE ABCDE ABCDE ABCDE";
  const blockH = (l: { fontSize: number; lines: string[] }) => l.lines.length * Math.round(l.fontSize * 1.2);
  it("also bounds the block height to half the frame", () => {
    const l = hookLayout(1080, 1920, ABCDE);
    expect(blockH(l)).toBeLessThanOrEqual(960);
    for (const line of l.lines) expect(estimateTextWidth(line, l.fontSize) <= 972 || l.fontSize === Math.round(1920 * 0.035)).toBe(true);
    const m = hookLayout(1080, 1920, "STOP PASTING YOUR CLIENT SECRETS INTO AI CHATS TODAY 2026 OK");
    expect(blockH(m)).toBeLessThanOrEqual(960);
  });
  it("keeps the title below the tall block inside the frame", () => {
    const a = titleCardArgs({ ...O, width: 1080, height: 1920, hook: ABCDE }, "/t/o.mp4", { titleFile: "/t/c_t.txt", hookFiles: hookLayout(1080, 1920, ABCDE).lines.map((_, i) => `/t/h${i}.txt`) });
    const j = a[a.indexOf("-vf") + 1] as string;
    const m = /c_t\.txt:fontsize=(\d+):[^,]*y=\(h\)\/2\+(\d+)/.exec(j)!;
    expect(1920 / 2 + Number(m[2]) + Number(m[1])).toBeLessThanOrEqual(0.95 * 1920);
  });
  it("keeps the base size for ordinary mixed-case text", () => {
    expect(hookLayout(1080, 1920, "Stop pasting client secrets into AI chats").fontSize).toBe(base);
  });
});
describe("titleCardArgs with a hook", () => {
  const P = { ...O, width: 1080, height: 1920, hook: "Stop pasting client secrets into AI chats" };
  const files = { titleFile: "/t/c_t.txt", hookFiles: ["/t/h0.txt", "/t/h1.txt", "/t/h2.txt"] };
  const vf = (a: string[]): string => a[a.indexOf("-vf") + 1] as string;
  it("draws one centered drawtext per hook line, each from its own textfile, larger than the title", () => {
    const j = vf(titleCardArgs(P, "/t/title.mp4", files));
    for (const f of files.hookFiles) {
      const m = new RegExp(`textfile=${f.replace(/[./]/g, "\\$&")}:[^,]*x=\\(w-text_w\\)/2`).exec(j);
      expect(m, f).not.toBeNull();
    }
    const hookSize = Number(/h0\.txt:fontsize=(\d+)/.exec(j)![1]);
    const titleSize = Number(/c_t\.txt:fontsize=(\d+)/.exec(j)![1]);
    expect(titleSize).toBeLessThan(hookSize);
    expect(j).not.toContain("Stop");
  });
  it("stacks the lines at fontSize*1.2 steps", () => {
    const j = vf(titleCardArgs(P, "/t/title.mp4", files));
    const size = Number(/h0\.txt:fontsize=(\d+)/.exec(j)![1]);
    const ys = files.hookFiles.map((f, i) => Number(new RegExp(`h${i}\\.txt:[^,]*:y=(\\d+)`).exec(j)![1]));
    expect(ys[1]! - ys[0]!).toBe(Math.round(size * 1.2));
    expect(ys[2]! - ys[1]!).toBe(Math.round(size * 1.2));
  });
  it("has no fade-in (frame 0 is full opacity) but keeps the fade-out", () => {
    const j = vf(titleCardArgs(P, "/t/title.mp4", files));
    expect(j).not.toContain("fade=t=in");
    expect(j).toContain("fade=t=out");
  });
  it("without hook files the args are unchanged and still fade in", () => {
    const a = titleCardArgs(O, "/t/title.mp4", { titleFile: "/t/c_t.txt", subtitleFile: "/t/c_s.txt" });
    const b = titleCardArgs({ ...O, hook: "x" }, "/t/title.mp4", { titleFile: "/t/c_t.txt", subtitleFile: "/t/c_s.txt" });
    expect(b).toEqual(a);
    expect(vf(a)).toContain("fade=t=in");
  });
});
