import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// vitest runs with cwd = repo root (see the other smoke tests).
const root = process.cwd();
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");
const json = (p: string): any => JSON.parse(read(p));
const pkg = json("package.json") as { name: string; version: string };

/** Flat `key: value` frontmatter of a Markdown file with a leading `---` block. */
export function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

// Shapes that only appear when a maintainer's private setup leaks into public files. Generic on
// purpose: this file is public too, so it names no private host, project or person.
const PRIVATE_PATTERNS: [string, RegExp][] = [
  ["secret-manager invocation", /\bdoppler\s+run\b/i],
  ["Linux home directory path", /\/home\/[a-z_][a-z0-9_-]*\//],
  ["macOS home directory path", /\/Users\/[A-Za-z][A-Za-z0-9._-]*\//],
  ["Windows home directory path", /[A-Za-z]:\\Users\\/],
  ["tailnet host name", /\.ts\.net\b/i],
  ["tailnet address", /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/],
  ["personal mail address", /[A-Za-z0-9._%+-]+@gmail\.com/i],
];

export function findPrivateStrings(text: string): string[] {
  return PRIVATE_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label);
}

// Built from code points so this source file holds no literal long dash.
const LONG_DASH = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014, 0x2015)}]`);

/** Repo-relative paths of every .md and .json file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(relative(root, p)));
    else if (/\.(md|json)$/.test(name)) out.push(relative(root, p));
  }
  return out.sort();
}

/** Files shipped to the public as documentation or plugin content. Grows as pages are added. */
function publicFiles(): string[] {
  return [...filesUnder(".claude-plugin"), ...filesUnder("skills"), ...filesUnder("agents")];
}

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
    const pins = [...md.matchAll(/agent-demo-video@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    expect(new Set(pins)).toEqual(new Set([pkg.version]));
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
    expect(findPrivateStrings("~/.cache/agent-demo-video and /path/to/venv")).toEqual([]);
  });

  it("the long-dash check catches a planted dash", () => {
    expect(LONG_DASH.test(`a ${String.fromCodePoint(0x2014)} b`)).toBe(true);
    expect(LONG_DASH.test("a - b, 8-10")).toBe(false);
  });

  it("scans every public file", () => {
    const files = publicFiles();
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const body = read(f);
      expect(findPrivateStrings(body), f).toEqual([]);
      expect(LONG_DASH.test(body), `${f} has a long dash`).toBe(false);
    }
  });
});
