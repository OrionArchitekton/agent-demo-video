import { describe, it, expect } from "vitest";
import { titleCardArgs, endCardArgs } from "./cards";

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
