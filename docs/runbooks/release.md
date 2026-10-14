---
verified: 2026-10-14
review_after: 2027-01-14
topics: [release, npm, github-release, claude-code-plugin]
references:
  - package.json
  - CHANGELOG.md
  - .claude-plugin/plugin.json
  - .claude-plugin/marketplace.json
---

# Releasing agent-demo-video

The maintainer runs these steps by hand. Nothing in the repository publishes on its own.

## Before you start

- `master` is green: `pnpm install && pnpm test && pnpm typecheck && pnpm build`.
- `package.json`, `.claude-plugin/plugin.json` and the marketplace entry carry the same version
  (the distribution test fails otherwise), and `CHANGELOG.md` has a section for it.
- Publish to npm before you announce the plugin. The plugin's skill runs
  `npx -y agent-demo-video@0.3.0`, which does not resolve until 0.3.0 is on npm.
- Record the current repository metadata for rollback:
  `gh repo view OrionArchitekton/agent-demo-video --json description,repositoryTopics`.

## 1. Log in to npm

```bash
npm login
npm whoami      # must print the account that owns agent-demo-video
```

## 2. Publish to npm

```bash
git switch master && git pull --ff-only
pnpm install --frozen-lockfile
npm publish --dry-run     # file list: dist, dist-remote, tools, README.md, LICENSE, package.json
npm publish
npm view agent-demo-video version     # prints 0.3.0
```

## 3. Create the GitHub release

Do this once the self-demo video is approved. The video is a release asset and is never committed.

```bash
awk '/^## 0\.3\.0$/{f=1;next} /^## /{f=0} f' CHANGELOG.md > /tmp/notes-0.3.0.md
gh release create v0.3.0 --target master --title "agent-demo-video v0.3.0" \
  --notes-file /tmp/notes-0.3.0.md agent-demo-video-self-demo.mp4
```

If the video is not ready yet, leave the file off the `create` command and attach it later with
`gh release upload v0.3.0 agent-demo-video-self-demo.mp4`.

## 4. Update the repository description and topics

```bash
gh repo edit OrionArchitekton/agent-demo-video \
  --description "Narrated, captioned demo videos of web apps from a script, headless. CLI and Claude Code plugin." \
  --remove-topic elevenlabs --add-topic claude-code --add-topic claude-code-plugin
```

## Verify

- `npm view agent-demo-video@0.3.0 version` prints `0.3.0`.
- In Claude Code, `/plugin marketplace add OrionArchitekton/agent-demo-video` and
  `/plugin install agent-demo-video@agent-demo-video` succeed, and `/plugin` lists the
  `demo-video` skill and the `render-reviewer` agent.
- The README poster opens the video from the release.

## Rollback

- npm: `npm deprecate agent-demo-video@0.3.0 "<reason>"`, then publish a fixed 0.3.1. (npm allows
  unpublishing only within 72 hours and never lets a version number be reused.)
- GitHub release: `gh release delete v0.3.0 --cleanup-tag`.
- Description and topics: rerun `gh repo edit` with the values recorded before step 4.
