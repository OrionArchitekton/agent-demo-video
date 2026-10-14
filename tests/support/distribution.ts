import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";


// vitest runs with cwd = repo root (see the other smoke tests).
export const root = process.cwd();
export const read = (p: string): string => readFileSync(resolve(root, p), "utf8");
export const json = (p: string): any => JSON.parse(read(p));
export const pkg = json("package.json") as { name: string; version: string };

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
export const PRIVATE_PATTERNS: [string, RegExp][] = [
  ["secret-manager invocation", /\bdoppler\s+run\b/i],
  // Only http(s) URLs are exempt, and only up to a quote or bracket, so file:// and ssh:// paths
  // and minified JSON (`"https://a.example","/home/x"`) are still caught.
  ["Linux home directory path", /(?<!https?:\/\/[^\s"'<>`]*)\/home\/[A-Za-z_][A-Za-z0-9._-]*/],
  ["macOS home directory path", /(?<!https?:\/\/[^\s"'<>`]*)\/Users\/[A-Za-z][A-Za-z0-9._-]*/],
  ["Windows home directory path", /[A-Za-z]:\\{1,2}Users\\{1,2}/],
  ["tailnet host name", /\.ts\.net\b/i],
  ["tailnet address", /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/],
  ["personal mail address", /[A-Za-z0-9._%+-]+@gmail\.com/i],
  ["API key value", /\bsk_[A-Za-z0-9]{20,}/],
  ["API key assignment", /ELEVENLABS_API_KEY["']?\s*(?:=\s*["']?|:\s*["'])[A-Za-z0-9_]{8,}/],
];

export function findPrivateStrings(text: string): string[] {
  return PRIVATE_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label);
}

// Built from code points so this source file holds no literal long dash.
export const LONG_DASH = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014, 0x2015)}]`);

/** Repo-relative paths of every .md and .json file under `dir`, recursively. */
export function filesUnder(dir: string): string[] {
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

/** Relative link targets in Markdown, anchor removed; skips URLs with a scheme and pure anchors. */
export function relativeLinks(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
    out.push(href.split("#")[0]!);
  }
  return out;
}

/** Repo paths named by absolute links to this repository's files on master, anchor removed. */
export function repoBlobLinks(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/https:\/\/github\.com\/OrionArchitekton\/agent-demo-video\/blob\/master\/([^\s)#`>"',\]]+)/g)) {
    out.push(m[1]!.replace(/\.+$/, ""));
  }
  return out;
}

export const EXPECTED_GUIDE_PAGES = [
  "pipeline",
  "script-format",
  "preflight",
  "authenticated-capture",
  "config",
  "voice",
  "third-party-tabs",
  "quality-checks",
  "motion-cards",
].map((p) => `docs/guide/${p}.md`);

/** Files shipped to the public as documentation or plugin content. Grows as pages are added. */
export function publicFiles(): string[] {
  return [
    "README.md",
    "docs/runbooks/release.md",
    ...filesUnder(".claude-plugin"),
    ...filesUnder("skills"),
    ...filesUnder("agents"),
    ...filesUnder("docs/guide"),
  ];
}


/** For every `agent-demo-video` reference inside an npx command line: the suffix after the name. */
export function npxPins(md: string): string[] {
  return [...md.matchAll(/npx\s[^\n`]*?agent-demo-video(@[^\s`)\]>"']*)?(?![\w-]|\.\w)/g)].map((m) =>
    (m[1] ?? "").replace(/[.,;:]+$/, ""),
  );
}

/** Every Markdown page under docs/guide, so a new page gets the guide checks automatically. */
export const GUIDE_PAGES = filesUnder("docs/guide").filter((f) => f.endsWith(".md"));
