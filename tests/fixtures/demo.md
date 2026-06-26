# Smoke Demo
### SHOT one
- target: dashboard
- narration: This is the first shot of the smoke test.
- action: goto url="FIXTURE_URL"
- action: click selector="#bootstrap" label="Bootstrap"

### SHOT two
- target: dashboard
- narration: And this is the second shot.
- action: goto url="FIXTURE_URL"
- action: click selector="#degraded"
