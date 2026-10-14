# Plugin Distribution: install as a Claude Code plugin, and a demo video the tool made of itself

## Intent

The tool is public but hard to adopt. A Claude Code user has to find the README, install the CLI by
hand and learn the workflow from a 565-line reference. npm still serves 0.2.0, which predates the
command voice provider, the quality checks and motion cards. Nothing shows what a finished video
looks like.

This change makes the repository installable as a Claude Code plugin that teaches Claude the
workflow and ships a pre-render reviewer agent, prepares the 0.3.0 release, rewrites the README to
lead with install and a first video, and adds a self-demo: a video the tool renders of a sample app
and then of its own script, run and checks.

It ships as two pull requests. The first covers distribution: plugin, skill, reviewer agent, README
and release preparation. The second covers the self-demo.

## Vocabulary

- **plugin**: a Claude Code plugin. It bundles the skill and the reviewer agent.
- **marketplace**: the plugin catalog Claude Code reads. This repository is its own marketplace, with
  one plugin.
- **skill**: the instructions that teach Claude how to make a demo video with this tool.
- **reviewer agent**: a read-only Claude Code agent. It checks a render's contact sheet and script
  against the brief before narration is spent, and returns flags. It never edits.
- **silent pass**: a full render with silent audio of estimated length (`FAKE_TTS=1`). It costs no
  narration.
- **self-demo**: the video in this repository that the tool renders of itself.
- **sample app**: a small offline web app shipped for the self-demo to record.
- **showcase page**: an offline page that shows the self-demo's own script, a replay of the real run
  that rendered it, and its checks.
- **release asset**: a file attached to a GitHub release rather than committed to the repository.

## Scenarios (tracer-bullet slices)

1. **Install in two commands.** A Claude Code user adds this repository as a marketplace and installs
   the plugin. They get the demo-video skill and the reviewer agent. The plugin's version always
   equals the package version.
2. **The skill drives a first video.** The skill states the prerequisites (Node 18 or newer, ffmpeg,
   the Playwright Chromium browser). It runs the CLI through `npx` pinned to the plugin's version,
   and it sets the order of work:
   1. script and config;
   2. preflight;
   3. silent pass;
   4. reviewer agent on the contact sheet;
   5. narrated render;
   6. read the render report.

   It explains the three voice choices: ElevenLabs with the user's own key, the command provider
   (any local text-to-speech the user runs), or silent.
3. **The reviewer agent flags before narration is spent.** Given a contact sheet, the script and a
   one-line brief, the reviewer agent returns a list of flags, each with a severity and the shot it
   concerns. It covers:
   - frame-zero hook legibility;
   - caption overlap;
   - blank or frozen shots;
   - text cut off at the frame edge;
   - narration that does not match what the shot shows.

   It has read-only tools.
4. **The README leads with adoption.** In order, the README gives:
   - what the tool does, in one paragraph;
   - the self-demo poster;
   - three ways to install (plugin, `npx`, from source);
   - a quickstart that reaches a silent-pass video with no API key;
   - short feature summaries.

   Deep reference material moves to guide pages linked from the README: selector gate,
   authenticated capture, config, voice and motion cards. No instruction depends on the
   maintainer's private setup.
5. **The release is prepared, not performed.** The changelog's unreleased section becomes 0.3.0. A
   release runbook gives the maintainer's exact steps, in order:
   1. log in to npm;
   2. publish 0.3.0;
   3. create the v0.3.0 GitHub release with the self-demo attached;
   4. update the repository description and topics.

   Publishing is the maintainer's action. Nothing in this change publishes.
6. **Nothing private ships.** These files contain no private infrastructure names, home-directory
   paths, secret-manager project names or host names:
   - the README;
   - the guide pages;
   - the skill;
   - the reviewer agent;
   - the plugin manifests;
   - the self-demo files.

   A test enforces this.
7. **The self-demo opens on the result.** The self-demo has seven shots, about two minutes:
   - shots 1 to 3 record the sample app (ticking tasks, typing a release name, a progress bar,
     shipping), with zoom on action and captions;
   - shot 4 shows the script those shots came from;
   - shot 5 replays the run that rendered it;
   - shot 6 shows the quality checks and contact sheet;
   - shot 7 shows the install line, then the motion end card.

   The video starts on a frame-zero hook. Both pages work offline, with no web fonts or CDNs.
8. **The showcase is honest.** The script view shows the self-demo's actual script, kept in sync by
   a test. The run view replays a log captured from a real run, with no absolute paths in it. The
   checks view shows values taken from a real render report and the contact sheet from a real
   silent pass.
9. **The video is a release asset.** The rendered MP4 is never committed. The README shows a
   committed poster image linked to the MP4's address on the v0.3.0 release, which resolves once the
   maintainer creates that release. The narrated render uses a voice configuration kept outside the
   repository, and the maintainer approves the narration text before it is voiced.

## Constraints

- No change to CLI behavior, the config schema or runtime dependencies.
- The supported Node version stays the same. Motion cards keep their own Node 22.12 floor.
- The poster image stays under 300 KB. The repository holds no video files.
- Public text uses no long dashes.

## Test seams

Seams chosen: the fewest that exercise every scenario.

1. **Distribution check (new, fast, file-level).** It reads the manifests, the skill and agent
   frontmatter and the public files. It covers scenarios 1, 2, 3, 6 and 8: versions match, the
   marketplace points at this repository, frontmatter is valid, nothing private leaks, the script
   view matches the script, and the run log has no absolute paths.
2. **Preflight (existing seam).** The selector gate runs against the sample app and showcase page
   with silent audio and no network. It covers scenario 7's actions.
3. **Plugin validation (live check).** Claude Code's own plugin validator, run on the repository.
   It covers scenario 1 at the consumer boundary.
4. **Manual render review.** A silent pass, the reviewer agent, the narrated render, then the
   transcript check and a frame check. It covers scenarios 7 to 9. A two-minute render stays out
   of the automated suite to keep the suite fast.

## Acceptance criteria

1. Adding the repository as a marketplace and installing the plugin succeeds, and the validator
   reports no errors.
2. The plugin version and the package version are equal, and a test fails if they drift.
3. The skill names the prerequisites, the pinned `npx` command, the six-step order and the three
   voice choices.
4. The reviewer agent has read-only tools, and its output format lists severity, shot and flag.
5. The README is about 220 lines or fewer, opens with the four items in scenario 4, and links every
   guide page. Every guide page exists.
6. The leak test passes on the shipped public files. A planted private string makes it fail.
7. The changelog has a 0.3.0 section, and the release runbook lists the four maintainer steps with
   exact commands.
8. Preflight passes for every self-demo shot with silent audio and no network.
9. The script-sync test and the run-log path test pass.
10. A narrated self-demo is rendered. Its transcript check reports no missing phrases, the reviewer
    agent's flags are resolved or accepted by the maintainer, and the maintainer has watched and
    approved it.
11. No MP4 is committed. The poster image is under 300 KB and links to the v0.3.0 release asset
    address.

## Out of scope

- Running the npm publish, the GitHub release or the repository metadata edit. These are maintainer
  steps from the runbook.
- Submitting to any third-party plugin directory.
- A vertical Shorts cut of the self-demo, and posting to any video platform.
- Wiring the reviewer agent into the CLI as a command.
