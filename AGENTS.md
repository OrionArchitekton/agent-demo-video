# AGENTS.md - agent-demo-video

## Repo Role

`agent-demo-video` is an open-source Node CLI that turns a `DEMO_SCRIPT.md` and
a running web app into a narrated, captioned MP4 using Playwright capture,
ElevenLabs-compatible narration, captions, and ffmpeg assembly.

## Boundaries

- Owns the CLI, rendering pipeline, demo config schema, tests, and package docs.
- Does not own the web apps being recorded, SaaS login credentials, publishing
  accounts, or downstream video hosting.
- Preserve headless, reproducible operation. Authentication flows must stay
  explicit and local to the user-provided config.

## Authority Order

1. `/home/orion/src/orion-estate/platform/orion-estate-audit/AGENTS.md`
2. `README.md`
3. `demo.config.sample.json`, `docs/`, and source tests
4. `package.json` scripts and TypeScript config

## Validation

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

For docs-only changes, run `git diff --check` at minimum.
