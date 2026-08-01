import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSelectorFindings, runPreflight } from "../src/preflight";
import { runPipeline } from "../src/pipeline";
import { ffmpeg } from "../src/ffmpeg";
import { DemoConfigSchema, ManifestSchema } from "../src/types";

const fixture = () => pathToFileURL(resolve("tests/fixtures/page.html")).href;

const shot = (id: string, selector: string) => ({
  id,
  target: "dashboard" as const,
  narration: "n",
  actions: [
    { kind: "goto" as const, url: fixture() },
    { kind: "highlight" as const, selector },
  ],
});

describe("resolveSelectorFindings (smoke)", () => {
  // The fixture page carries exactly one #bootstrap and exactly two <button>.
  // A selector is good only when it resolves to EXACTLY one element: zero is a
  // silent no-op in the overlay, and more than one means querySelector quietly
  // takes the first, which is how a bare tag selector looks correct while
  // pointing at the wrong element.
  it("passes a unique selector and distinguishes zero-match from ambiguous, with counts", async () => {
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });
    const manifest = ManifestSchema.parse({
      shots: [shot("unique", "#bootstrap"), shot("zero", "#definitely-not-here"), shot("many", "button")],
    });

    // Filter to selector findings: a page-level note (e.g. a slow settle under
    // load) is legitimate but load-dependent, and must not make this brittle.
    const f = (await resolveSelectorFindings(manifest, cfg)).filter((x) => x.selector);

    expect(f.map((x) => [x.shotId, x.kind])).toEqual([
      ["zero", "no-match"],
      ["many", "ambiguous"],
    ]);
    expect(f.find((x) => x.shotId === "many")!.matches).toBe(2);
    expect(f.find((x) => x.shotId === "zero")!.matches).toBe(0);
  }, 60_000);

  // A live shot drives a saved auth profile. Resolving it with the gate's own
  // unauthenticated context would hit the login wall and report every selector
  // as a zero-match — a fail-CLOSED gate blocking a correct script. Reported as
  // explicitly unverified instead: visible, but not a blocking finding.
  it("reports a live shot as unverified rather than resolving it logged-out", async () => {
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });
    const manifest = ManifestSchema.parse({
      shots: [{ ...shot("authed", "#bootstrap"), target: "live" }],
    });

    const f = await resolveSelectorFindings(manifest, cfg);

    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("unverified");
    expect(f[0]!.severity).toBe("info");
  }, 30_000);

  // A shot may navigate more than once. Resolving every selector against the
  // shot's FIRST goto counts later selectors at the wrong page: fail-open when
  // the name happens to exist on page one, false-blocking when it does not.
  it("resolves each selector against the navigation in effect at its position", async () => {
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });
    const pageA = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const pageB = pathToFileURL(resolve("tests/fixtures/reveal.html")).href;
    const manifest = ManifestSchema.parse({
      shots: [{
        id: "two-pages", target: "dashboard", narration: "n",
        actions: [
          { kind: "goto", url: pageA },
          { kind: "highlight", selector: "#bootstrap" },  // only on page A
          { kind: "goto", url: pageB },
          { kind: "highlight", selector: "#open" },       // only on page B
        ],
      }],
    });

    expect(await resolveSelectorFindings(manifest, cfg)).toEqual([]);
  }, 60_000);

  // The gate resolves against the freshly-loaded page and deliberately runs no
  // actions. A selector that only exists after a click is therefore UNKNOWN to
  // it, not absent: fail-closing on that would block a correct script.
  it("does not block a selector that an earlier click would have revealed", async () => {
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });
    const manifest = ManifestSchema.parse({
      shots: [{
        id: "reveals", target: "dashboard", narration: "n",
        actions: [
          { kind: "goto", url: pathToFileURL(resolve("tests/fixtures/reveal.html")).href },
          { kind: "click", selector: "#open" },
          { kind: "highlight", selector: "#revealed" },
        ],
      }],
    });

    const f = await resolveSelectorFindings(manifest, cfg);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("info");
    expect(f[0]!.message).toMatch(/could not be verified/i);
  }, 60_000);

  // The render's locator AUTO-WAITS, so a gate that counts once instantly is
  // STRICTER than the render. This PR ships a fixture proving capture waits for
  // a 900ms element; the gate must agree, or it blocks a script that renders.
  it("waits for a late-hydrating element instead of calling it missing", async () => {
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });
    const manifest = ManifestSchema.parse({
      shots: [{
        id: "late", target: "dashboard", narration: "n",
        actions: [
          { kind: "goto", url: pathToFileURL(resolve("tests/fixtures/late-element.html")).href },
          { kind: "highlight", selector: "#late" },
        ],
      }],
    });

    expect(await resolveSelectorFindings(manifest, cfg)).toEqual([]);
  }, 60_000);

  // The render resolves with Playwright's engine, which accepts `>> nth=`,
  // `text=` and xpath. Counting with document.querySelectorAll made those a
  // blocking "invalid selector" and refused this repo's OWN shipped demo
  // (demos/proctor ships `.toggle-btn >> nth=1`).
  it("accepts Playwright engine syntax the render accepts", async () => {
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });
    const manifest = ManifestSchema.parse({
      shots: [{
        id: "engine", target: "dashboard", narration: "n",
        actions: [
          { kind: "goto", url: fixture() },
          // `button` alone is ambiguous (2 matches); nth=1 is the correct
          // disambiguation, and the gate must not punish it.
          { kind: "click", selector: "button >> nth=1" },
        ],
      }],
    });

    expect(await resolveSelectorFindings(manifest, cfg)).toEqual([]);
  }, 60_000);

  // The render's locator waits Playwright's full default (capture never
  // overrides it). A gate given a SHORTER budget has strictly weaker evidence
  // than the render, so an element that simply had not arrived yet must be
  // reported, never blocked: otherwise a slow SPA is refused a render that
  // would have succeeded.
  it("reports rather than blocks when its wait budget is shorter than the render's", async () => {
    const cfg = DemoConfigSchema.parse({
      script: "x", dashboardBaseUrl: "http://localhost:3000", preflightWaitMs: 100,
    });
    const manifest = ManifestSchema.parse({
      shots: [{
        id: "slow", target: "dashboard", narration: "n",
        actions: [
          { kind: "goto", url: fixture() },
          { kind: "highlight", selector: "#never-arrives" },
        ],
      }],
    });

    // A selector that never arrives, rather than one racing the fixture's own
    // 900ms timer: under load the element had already landed before the count.
    const f = (await resolveSelectorFindings(manifest, cfg)).filter((x) => x.selector);

    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("info");
    expect(f[0]!.message).toMatch(/budget/i);
  }, 60_000);

  // Ambiguity is decidable instantly, so this asserts the blocking grade without
  // sitting through the full absence budget the previous test already covers.
  // Playwright reads `timeout: 0` as WAIT FOREVER, not "do not wait". Passing the
  // budget through unguarded meant an operator setting 0 to disable waiting
  // hung the gate indefinitely, before any TTS, with no output. The repo's own
  // `capture.settleMs: 0` idiom means "disabled", so 0 must mean that here too.
  it("treats a zero wait budget as no wait, not as wait forever", async () => {
    const cfg = DemoConfigSchema.parse({
      script: "x", dashboardBaseUrl: "http://localhost:3000", preflightWaitMs: 0,
    });
    const manifest = ManifestSchema.parse({
      shots: [{
        id: "nowait", target: "dashboard", narration: "n",
        actions: [
          { kind: "goto", url: fixture() },
          { kind: "highlight", selector: "#never-arrives" },
        ],
      }],
    });

    const f = (await resolveSelectorFindings(manifest, cfg)).filter((x) => x.selector);

    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("info");
  }, 20_000);

  it("grades a resolvable selector defect as blocking", async () => {
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });
    const manifest = ManifestSchema.parse({ shots: [shot("many", "button")] });

    const f = await resolveSelectorFindings(manifest, cfg);

    expect(f[0]!.severity).toBe("blocking");
  }, 60_000);
});

describe("preflight gate in runPipeline (smoke)", () => {
  // Vitest reuses a worker across files, so an unrestored env var leaks into
  // whatever runs next in the same worker.
  const prevFakeTts = process.env.FAKE_TTS;
  beforeAll(() => { process.env.FAKE_TTS = "1"; });
  afterAll(() => {
    if (prevFakeTts === undefined) delete process.env.FAKE_TTS;
    else process.env.FAKE_TTS = prevFakeTts;
  });

  /** A one-shot script whose highlight selector matches BOTH fixture buttons. */
  async function ambiguousScript(): Promise<{ dir: string; scriptPath: string }> {
    const dir = await mkdtemp(join(tmpdir(), "preflight-"));
    const scriptPath = join(dir, "demo.md");
    await writeFile(
      scriptPath,
      [
        "### SHOT amb",
        "- target: dashboard",
        "- narration: A shot whose selector is ambiguous.",
        `- action: goto url="${pathToFileURL(resolve("tests/fixtures/page.html")).href}"`,
        '- action: highlight selector="button"',
        "",
      ].join("\n"),
    );
    return { dir, scriptPath };
  }

  // The whole point of the gate: a selector mistake must cost nothing. TTS is
  // the first spend in the pipeline, so "the audio dir was never created" is
  // the artifact that proves the gate fired ahead of it.
  it("fails an ambiguous selector before a single narration is synthesized", async () => {
    const { dir, scriptPath } = await ambiguousScript();
    const cfg = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(dir, "out"),
      resolution: { width: 1280, height: 720 },
    });

    await expect(runPipeline(cfg)).rejects.toThrow(/preflight/i);
    expect(existsSync(join(dir, "out", "audio"))).toBe(false);
  }, 120_000);

  it("invalidates an earlier render receipt before a blocking preflight exits", async () => {
    const { dir, scriptPath } = await ambiguousScript();
    const out = join(dir, "out");
    const report = join(out, "render-report.json");
    await mkdir(out, { recursive: true });
    await writeFile(report, '{"parity":{"status":"pass"}}\n');
    const cfg = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out,
      resolution: { width: 1280, height: 720 },
    });

    await expect(runPipeline(cfg)).rejects.toThrow(/preflight/i);

    expect(existsSync(report)).toBe(false);
  }, 120_000);

  it("blocks a wrong-aspect fullBleed clip before narration while accepting a matching composition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "preflight-fullbleed-"));
    const landscape = join(dir, "landscape.mp4");
    const portrait = join(dir, "portrait.mp4");
    const portraitSar = join(dir, "portrait-sar.mp4");
    const portraitSymlink = join(dir, "portrait-symlink.mp4");
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", landscape]);
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=180x320:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", portrait]);
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=green:s=90x320:d=0.2", "-vf", "setsar=2/1", "-c:v", "libx264", "-pix_fmt", "yuv420p", portraitSar]);
    await symlink(portrait, portraitSymlink);
    const config = DemoConfigSchema.parse({
      script: join(dir, "demo.md"),
      dashboardBaseUrl: "http://localhost:3000",
      out: join(dir, "out"),
      resolution: { width: 360, height: 640 },
    });
    const manifestFor = (clip: string) => ManifestSchema.parse({
      shots: [{
        id: "portrait-proof",
        target: "prebaked",
        clip,
        fullBleed: true,
        narration: "A finished portrait composition.",
        actions: [],
      }],
    });

    expect(await runPreflight(manifestFor(portrait), config)).toEqual([]);
    const symlinkFindings = await runPreflight(
      manifestFor(portraitSymlink),
      config,
    );
    expect(symlinkFindings).toMatchObject([{
      shotId: "portrait-proof",
      kind: "missing-clip",
      severity: "blocking",
    }]);
    const findings = await runPreflight(manifestFor(landscape), config);
    expect(findings).toMatchObject([{
      shotId: "portrait-proof",
      kind: "invalid-clip-geometry",
      severity: "blocking",
    }]);
    const sarFindings = await runPreflight(manifestFor(portraitSar), config);
    expect(sarFindings).toMatchObject([{
      shotId: "portrait-proof",
      kind: "invalid-clip-geometry",
      severity: "blocking",
    }]);
    expect(sarFindings[0]?.message).toMatch(/non-square sample aspect ratio 2:1.*square pixels/s);

    await writeFile(
      config.script,
      [
        "### SHOT portrait-proof",
        "- target: prebaked",
        `- clip: ${landscape}`,
        "- fullBleed: true",
        "- narration: A finished portrait composition.",
        "",
      ].join("\n"),
    );
    await expect(runPipeline(config)).rejects.toThrow(/preflight/i);
    expect(existsSync(join(dir, "out", "audio"))).toBe(false);
  }, 120_000);

  // Declining must restore the pre-gate behaviour AND say so. A silent decline
  // would read identically to a gate that ran and found nothing, which is the
  // exact ambiguity this gate exists to remove.
  it("lets a declined run past the gate, and reports the decline", async () => {
    const { dir, scriptPath } = await ambiguousScript();
    const cfg = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(dir, "out"),
      resolution: { width: 1280, height: 720 },
      preflight: false,
    });
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));

    let err: Error | undefined;
    try {
      await runPipeline(cfg).catch((e) => void (err = e as Error));
    } finally {
      console.warn = realWarn;
    }

    // It still fails downstream (the selector really is ambiguous) — but NOT at
    // the gate, and only after narration was synthesized. That is the cost the
    // gate saves, made visible.
    expect(err).toBeDefined();
    expect(err!.message).not.toMatch(/preflight gate failed/);
    expect(existsSync(join(dir, "out", "audio"))).toBe(true);
    expect(warnings.join("\n")).toMatch(/preflight gate DECLINED/);
  }, 120_000);
});
