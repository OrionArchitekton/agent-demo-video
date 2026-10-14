# agent-demo-video: the self-demo

### SHOT checklist
- target: dashboard
- narration: This is a release checklist for a small web app. Watch it get filled in, one step at a time.
- action: goto url="/app.html"
- action: highlight selector="[data-testid=checklist]"
- action: wait ms=800

### SHOT name-release
- target: dashboard
- narration: First we name the release, then tick off the tests and the docs. The camera follows each click, and the captions keep pace with the voice.
- action: goto url="/app.html"
- action: type selector="[data-testid=release-name]" text="Spring release"
- action: click selector="[data-testid=task-tests]"
- action: click selector="[data-testid=task-docs]"
- action: wait ms=600

### SHOT ship
- target: dashboard
- narration: The last box fills the progress bar, and one click ships it.
- action: goto url="/app.html?name=Spring%20release&done=tests,docs"
- action: click selector="[data-testid=task-notes]"
- action: click selector="[data-testid=ship]"
- action: wait ms=1200
