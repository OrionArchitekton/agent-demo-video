# Pre-flight selector gate

Before any narration is synthesized, the pipeline resolves every selector your script
declares against the page that shot opens at that point, and refuses to start when one of
them provably will not do what the script says.

```text
$ demo-video demo.config.json
  BLOCKING  shot "12-execution-boundary": selector "p" is ambiguous, 43 matches on http://localhost:3000/guide (the strict locator needs exactly one)
  BLOCKING  shot "05-plate": selector "[data-line='82']" matches nothing on http://localhost:3000/guide
  BLOCKING  shot "08-recap" uses 2 selector(s) but declares no goto action; capture builds a fresh context per shot, so this shot runs against about:blank and every locator waits out its full timeout
  INFO      shot "04-approve": selector ".verdict-box" matches nothing on http://localhost:3000/ (an earlier click or type in this shot can change the DOM, and the gate runs no actions, so this could not be verified)
✗ [agent-demo-video] preflight gate failed: 3 finding(s); no narration was synthesized.
```

It reports four things a script cannot tell you on its own:

- a selector that matches **nothing**, which the highlight overlay used to turn into a
  silent no-op;
- a selector that matches **more than one** element, because `document.querySelector`
  takes the first match, so a bare `p` or `code` selector looks correct while pointing
  somewhere else entirely;
- a shot that references a selector but **never navigates**. Capture builds a fresh
  browser context per shot, so such a shot runs against `about:blank` and every locator
  waits out its full timeout;
- a `prebaked` shot that declares selector actions, which capture never runs.

The gate resolves selectors with the same engine capture uses, against a page carrying
the same injected overlay, and waits for an element that hydrates in after load. Where it
resolves differently from the render it would be reporting on its own limitations, not on
your script.

It therefore only BLOCKS on a claim it can actually make. These are reported at `INFO` and
never fail a run:

- a selector that a preceding `click` or `type` in the same shot would have revealed (the
  gate runs no actions, so it cannot see that DOM);
- an ambiguous `hover`, because `page.hover` resolves non-strictly and renders fine;
- an auth-walled `live` shot, because the gate runs unauthenticated and would see the
  login wall;
- a page that did not settle before its selectors were counted.

`out/render-report.json` records whether the gate ran, whether it was declined, and which
shots it could not adjudicate, so a finished video says for itself how it was checked.

The gate is fail-closed. Set `preflight: false` in the config, or pass `--no-preflight`
for a single run, to decline it; a declined run says so in its output.

## Production runs

For a production attempt, pass `--out <new-directory>`. This per-run override
atomically reserves the fresh output name and refuses an existing path before
reading the script or changing an artifact. On a Linux filesystem under Linux
or WSL (not a mounted Windows/DrvFs path), later writes stay bound to a new
private staging-directory handle while the requested name remains occupied.
A changed claim fails the run without deleting the replacement; success parks
and retains the authenticated claim as `.agent-demo-video-output-claim` inside
the output, then publishes the staged directory with a no-clobber rename. This
protects against existing targets and accidental or cooperating concurrent
reuse. It is not an isolation boundary against a malicious process running as
the same Unix user, which can manipulate that user's pathnames and `/proc`
handles.
Omitting the flag preserves the legacy reusable `config.out` behavior. Use
distinct fresh directories for rehearsal and real narration.
`--clips-dir <absolute-directory>` can pin a run to attempt-owned copies of
prebaked inputs without changing the config file. Passing it also binds every
prebaked `clip:` strictly beneath that directory for the run: each `clip:`
must be a clean relative path (no absolute paths, no `.` or `..` components),
a path carrying its own directory resolves beneath the override directory
rather than the config directory, and each source is opened through
symlink-refusing directory handles (Linux only; the run fails closed
elsewhere). The config-relative resolution table under
[Third-party tabs](third-party-tabs.md) does not apply to a
`--clips-dir` run, so the attempt-owned layout must mirror each `clip:`'s
relative path beneath the override directory. `--script <absolute-file>`
does the same for a copied narration manifest. Both overrides require absolute
paths so their meaning never changes with the launch or config directory.

Every successful `render-report.json` keeps the existing short config and
script hashes and also records full SHA-256 values for the resolved config,
script, and each ordered prebaked clip. Before narration spend, the pipeline
copies each source clip into a private read-only render binding. The renderer
and report consume only those bound bytes, so an ordinary later export to the
operator source path cannot change the artifact or its digest.

For a local source-run production render, `--attest-source-build` is reserved
for the committed snapshot launcher. The launcher bytes are streamed from one
fixed commit, create a private detached worktree, verify and freeze every
scoped repository byte before application modules load, and then invoke that
snapshot's `src/cli.ts`. Direct mutable-checkout use is refused. The report
records snapshot execution, the commit, scoped Git tree, package manifest, and
dependency-lock hashes, and the pipeline blocks the receipt if that state
changes during rendering. Installed dependency and system-tool bytes remain
reported toolchain inputs, not part of the repository source claim. The frozen
dependency install receives no render secrets and ignores caller npm/pnpm
configuration, lifecycle scripts, and pnpm hook files. Snapshot attestation is
intentionally incompatible with `--render-host` until remote bundles have their
own content-addressed attestation.

Back to the [README](../../README.md).
