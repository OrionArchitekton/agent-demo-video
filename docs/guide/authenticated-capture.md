# Authenticated SaaS capture (`target: live`)

`target: live` drives an authenticated SaaS app (Slack, Notion, Linear, Stripe, any
Google-SSO app) behind its real login: no hand-captured clip needed. A live shot uses
the **same action syntax as `dashboard`**; the only difference is it runs against a saved
browser profile.

It's a two-step flow:

```bash
# 1. One-time (or whenever the session expires): log in interactively.
#    A real browser opens at config.capture.auth.loginUrl; log in (incl. MFA),
#    then press Enter in the terminal once you can see your workspace.
demo-video login your-config.json

# 2. Render: live shots drive the saved profile headlessly.
demo-video your-config.json
```

Configure the auth section in `demo.config.json`:

```jsonc
{
  "script": "DEMO.md",
  "dashboardBaseUrl": "http://localhost:3000",
  "capture": {
    "auth": {
      "loginUrl": "https://app.slack.com/",
      "loggedInSelector": "[data-qa=\"channel_sidebar\"]", // optional; see below
      "confirmMode": "operator"                              // operator | selector | auto
    }
  }
}
```

A live shot in the manifest:

```markdown
### SHOT workspace
- target: live
- narration: Here's the decision filed straight into our Slack canvas.
- action: goto url="https://app.slack.com/client/T123/C456"
- action: highlight selector="[data-qa=\"message_input\"]"
```

**Login detection.** The default `confirmMode: "operator"` treats *your Enter keypress*
as the authoritative "logged in" signal. This is robust for apps whose DOM we don't control, and
it absorbs MFA/SSO with no special handling. An optional `loggedInSelector` enables
`confirmMode: "selector"` / `"auto"` (wait for a stable element instead) for unattended
re-auth, and is also used as a **record-time expiry guard**: if the marker is missing when
a live shot runs, the render **fails closed** ("session expired, re-run `demo-video login`")
rather than silently recording the logged-out wall. A bare URL match is never used (it
false-positives on SSO redirects).

**Auth at rest (security).** The saved profile holds session cookies/tokens, so it lives
**outside the repo** by default: `~/.cache/agent-demo-video` (honors `XDG_CACHE_HOME`).
It is never committed; `.gitignore` also excludes `.auth/`, `*.playwright-profile/`, and
`storageState*.json` as belt-and-suspenders, and a test (`tests/security.test.ts`) asserts
no auth artifact ever reaches a tracked path.

Back to the [README](../../README.md).
