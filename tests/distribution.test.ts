import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  EXPECTED_GUIDE_PAGES,
  GUIDE_PAGES,
  LONG_DASH,
  findPrivateStrings,
  frontmatter,
  json,
  npxPins,
  pkg,
  publicFiles,
  read,
  relativeLinks,
  repoBlobLinks,
  root,
} from "./support/distribution";

describe("plugin and marketplace manifests", () => {
  const plugin = json(".claude-plugin/plugin.json");
  const market = json(".claude-plugin/marketplace.json");

  it("names the plugin after the package and carries the package version", () => {
    expect(plugin.name).toBe(pkg.name);
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.license).toBe("MIT");
    expect(plugin.repository).toBe("https://github.com/OrionArchitekton/agent-demo-video");
  });

  it("makes the repository a marketplace with exactly this plugin at its root", () => {
    expect(market.name).toBe(pkg.name);
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0].name).toBe(plugin.name);
    expect(market.plugins[0].source).toBe("./");
    expect(market.plugins[0].version).toBe(pkg.version);
  });
});

describe("npxPins", () => {
  it("reports unpinned, tagged and pinned references", () => {
    expect(npxPins("run `npx -y agent-demo-video x`")).toEqual([""]);
    expect(npxPins("npx -y agent-demo-video@latest x")).toEqual(["@latest"]);
    expect(npxPins("npx -y agent-demo-video@0.3.0-rc.1 x")).toEqual(["@0.3.0-rc.1"]);
    expect(npxPins("Run npx agent-demo-video.")).toEqual([""]);
    expect(npxPins("(npx agent-demo-video)")).toEqual([""]);
    expect(npxPins("then npx -y agent-demo-video")).toEqual([""]);
    expect(npxPins("`npx -y agent-demo-video@0.3.0`, then stop")).toEqual(["@0.3.0"]);
    expect(npxPins("use npx -y agent-demo-video@0.3.0.")).toEqual(["@0.3.0"]);
    for (const bad of ["@^0.3.0", "@~0.3.0", "@"]) {
      expect(npxPins(`npx -y agent-demo-video${bad} demo.json`), bad).toEqual([bad]);
      expect(npxPins(`npx -y agent-demo-video${bad} demo.json`)[0], bad).not.toBe("@0.3.0");
    }
    expect(npxPins("npx -y -p agent-demo-video@1.2.3 -p hyperframes@4.5.6 demo-video c.json")).toEqual([
      "@1.2.3",
    ]);
  });
});

describe("render-reviewer agent", () => {
  const md = read("agents/render-reviewer.md");
  const fm = frontmatter(md);

  it("is named render-reviewer and has only read-only tools", () => {
    expect(fm.name).toBe("render-reviewer");
    expect(fm.description?.length ?? 0).toBeGreaterThan(40);
    const tools = (fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) expect(["Read", "Glob", "Grep"]).toContain(t);
  });

  it("returns a verdict and one line per flag with severity and shot", () => {
    expect(md).toContain("VERDICT: READY | FIX FIRST");
    expect(md).toContain("`SEVERITY | shot <id> | what is wrong | smallest fix`");
    expect(md).toContain("UNCHECKED");
  });
});

describe("demo-video skill", () => {
  const md = read("skills/demo-video/SKILL.md");
  const fm = frontmatter(md);

  it("has a when-to-use description", () => {
    expect(fm.name).toBe("demo-video");
    expect(fm.description).toMatch(/^Use when /);
  });

  it("names the prerequisites and runs the CLI pinned to the package version", () => {
    for (const s of ["Node 18", "ffmpeg", "ffprobe", "npx playwright install chromium"]) {
      expect(md).toContain(s);
    }
    expect(md).toContain(`npx -y agent-demo-video@${pkg.version} `);
    const pins = npxPins(md);
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) expect(pin).toBe(`@${pkg.version}`);
  });

  it("sets the six-step order of work", () => {
    const steps = [
      "**Write the script and config.**",
      "**Preflight.**",
      "**Silent pass.**",
      "**Review.**",
      "**Narrated render.**",
      "**Read the report.**",
    ];
    const at = steps.map((s) => md.indexOf(s));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(md).toContain("render-reviewer");
    expect(md).toContain("render-report.json");
  });

  it("says live capture requires the logged-in selector unless explicitly unguarded", () => {
    expect(md).toContain("capture.auth.loggedInSelector");
    expect(md).toContain("capture.auth.allowUnguardedLiveCapture");
    expect(md).not.toMatch(/usually\s+`capture\.auth\.loggedInSelector/);
  });

  it("explains the three voice choices", () => {
    expect(md).toContain("ELEVENLABS_API_KEY");
    expect(md).toContain('"provider": "command"');
    expect(md).toContain("FAKE_TTS=1");
  });
});

describe("public files carry nothing private and no long dashes", () => {
  it("the scanner catches planted private strings", () => {
    expect(findPrivateStrings("run: doppler run -p proj -c prd -- pnpm demo")).toContain(
      "secret-manager invocation",
    );
    expect(findPrivateStrings("see /home/someone/src/thing")).toContain("Linux home directory path");
    expect(findPrivateStrings("host box.tail1234.ts.net")).toContain("tailnet host name");
    expect(findPrivateStrings("at 100.80.1.2")).toContain("tailnet address");
    expect(findPrivateStrings("mail someone@gmail.com")).toContain("personal mail address");
    expect(findPrivateStrings("see /home/someone")).toContain("Linux home directory path");
    expect(findPrivateStrings('path "/home/someone/src"')).toContain("Linux home directory path");
    expect(findPrivateStrings('path "/Users/someone"')).toContain("macOS home directory path");
    expect(findPrivateStrings("see /Users/someone/x")).toContain("macOS home directory path");
    expect(findPrivateStrings("https://x.example/home/feed")).toEqual([]);
    expect(findPrivateStrings("[a](https://x.example/Users/list)")).toEqual([]);
    expect(findPrivateStrings("ELEVENLABS_API_KEY=your_key_here")).toContain("API key assignment");
    expect(findPrivateStrings("ELEVENLABS_API_KEY=<your key>")).toEqual([]);
    expect(findPrivateStrings("ELEVENLABS_API_KEY: required for narration")).toEqual([]);
    expect(findPrivateStrings('{"ELEVENLABS_API_KEY": "' + "x1".repeat(6) + '"}')).toContain("API key assignment");
    for (const leak of [
      "file:///home/someone/x",
      "file:///Users/someone/x",
      "file:///C:/Users/someone/x",
      "ssh://host/home/someone",
      '{"homepage":"https://a.example","cwd":"/home/someone"}',
      '{"url":"https://a.example","p":"/Users/someone/x"}',
    ]) {
      expect(findPrivateStrings(leak).length, leak).toBeGreaterThan(0);
    }
    expect(findPrivateStrings("http://localhost:3000/home/overview")).toEqual([]);
    expect(findPrivateStrings("C:\\Users\\x")).toContain("Windows home directory path");
    expect(findPrivateStrings('"C:\\\\Users\\\\x"')).toContain("Windows home directory path");
    expect(findPrivateStrings("key sk_" + "a".repeat(24))).toContain("API key value");
    expect(findPrivateStrings(["ELEVENLABS_API", "KEY=" + "x1".repeat(6)].join("_"))).toContain("API key assignment");
    expect(findPrivateStrings("Set ELEVENLABS_API_KEY in the environment")).toEqual([]);
    expect(findPrivateStrings("~/.cache/agent-demo-video and /path/to/venv")).toEqual([]);
  });

  it("the long-dash check catches a planted dash", () => {
    expect(LONG_DASH.test(`a ${String.fromCodePoint(0x2014)} b`)).toBe(true);
    expect(LONG_DASH.test("a - b, 8-10")).toBe(false);
  });

  it("scans every public file", () => {
    const files = publicFiles();
    for (const dir of [".claude-plugin", "skills", "agents", "docs/guide"]) {
      expect(files.some((f) => f.startsWith(`${dir}/`)), `${dir} contributes no scanned file`).toBe(true);
    }
    expect(files).toContain("README.md");
    for (const f of files) {
      const body = read(f);
      expect(findPrivateStrings(body), f).toEqual([]);
      expect(LONG_DASH.test(body), `${f} has a long dash`).toBe(false);
    }
  });
});

describe("guide pages", () => {
  it("the link helpers extract what they should", () => {
    expect(relativeLinks("[a](x.md#y) [b](https://e.com/z) [c](#top) [d](../../src/t.ts)")).toEqual(["x.md", "../../src/t.ts"]);
    expect(
      repoBlobLinks("[a](https://github.com/OrionArchitekton/agent-demo-video/blob/master/docs/guide/voice.md#x)"),
    ).toEqual(["docs/guide/voice.md"]);
    expect(
      repoBlobLinks(
        'see https://github.com/OrionArchitekton/agent-demo-video/blob/master/docs/guide/config.md. And "https://github.com/OrionArchitekton/agent-demo-video/blob/master/README.md", ok',
      ),
    ).toEqual(["docs/guide/config.md", "README.md"]);
  });

  it("the page list is derived from the folder and holds the nine expected pages", () => {
    expect(GUIDE_PAGES).toEqual(expect.arrayContaining(EXPECTED_GUIDE_PAGES));
  });

  it("all exist, start with a title and end by pointing back to the README", () => {
    for (const page of GUIDE_PAGES) {
      expect(existsSync(resolve(root, page)), page).toBe(true);
      const body = read(page);
      expect(body.startsWith("# "), `${page} starts with a title`).toBe(true);
      expect(body.trimEnd().endsWith("Back to the [README](../../README.md)."), page).toBe(true);
    }
  });

  it("every relative link in them resolves", () => {
    for (const page of GUIDE_PAGES) {
      for (const href of relativeLinks(read(page))) {
        expect(existsSync(resolve(root, dirname(page), href)), `${page} -> ${href}`).toBe(true);
      }
    }
  });

  it("link to other guide pages, never to README anchors that moved", () => {
    for (const page of GUIDE_PAGES) {
      expect(read(page), page).not.toMatch(
        /\]\(#(authenticated-saas|quality-checks|motion-cards|pre-flight|third-party-tabs)/,
      );
    }
  });

  it("every absolute link to this repository's files points at a file that exists", () => {
    let skillLinks = 0;
    for (const f of publicFiles()) {
      const links = repoBlobLinks(read(f));
      if (f === "skills/demo-video/SKILL.md") skillLinks = links.length;
      for (const path of links) expect(existsSync(resolve(root, path)), `${f} -> ${path}`).toBe(true);
    }
    expect(skillLinks).toBeGreaterThan(0);
  });
});

describe("README leads with adoption", () => {
  const md = read("README.md");

  it("stays short", () => {
    expect(md.split("\n").length).toBeLessThanOrEqual(220);
  });

  it("opens with what it is, then install, then quickstart", () => {
    const install = md.indexOf("\n## Install");
    const quick = md.indexOf("\n## Quickstart");
    const features = md.indexOf("\n## Features");
    expect(install).toBeGreaterThan(md.indexOf("\n\n", md.indexOf("# agent-demo-video")));
    expect(quick).toBeGreaterThan(install);
    expect(features).toBeGreaterThan(quick);
  });

  it("gives three ways to install", () => {
    const section = md.slice(md.indexOf("\n## Install"), md.indexOf("\n## Quickstart"));
    expect(section).toContain("/plugin marketplace add OrionArchitekton/agent-demo-video");
    expect(section).toContain("/plugin install agent-demo-video@agent-demo-video");
    expect(section).toContain(`npx -y agent-demo-video@${pkg.version} `);
    expect(section).toContain("git clone https://github.com/OrionArchitekton/agent-demo-video.git");
  });

  it("has a keyless quickstart on the bundled smoke demo", () => {
    expect(md).toContain("FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json");
  });

  it("links every guide page and every relative link resolves", () => {
    const links = relativeLinks(md);
    for (const page of GUIDE_PAGES) expect(links, page).toContain(page);
    for (const href of links) expect(existsSync(resolve(root, href)), href).toBe(true);
  });
});
