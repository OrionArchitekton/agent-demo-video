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
- action: wait ms=2000
- action: click selector="[data-testid=task-tests]"
- action: wait ms=2000
- action: click selector="[data-testid=task-docs]"
- action: wait ms=600

### SHOT ship
- target: dashboard
- narration: The last box fills the progress bar, and one click ships it.
- action: goto url="/app.html?name=Spring%20release&done=tests,docs"
- action: wait ms=1500
- action: click selector="[data-testid=task-notes]"
- action: wait ms=1500
- action: click selector="[data-testid=ship]"
- action: wait ms=1200

### SHOT script
- target: dashboard
- narration: None of that was recorded by hand. It came from this script: each shot is a heading, one line of narration, and the clicks to perform.
- action: goto url="/showcase.html#script"
- action: highlight selector="[data-testid=script-text]"
- action: wait ms=1500

### SHOT run
- target: dashboard
- narration: One command turned the script into the video. The voice comes first, and its timing sets the pace for the recording and the captions.
- action: goto url="/showcase.html#run"
- action: wait ms=3000

### SHOT checks
- target: dashboard
- narration: Then the tool checks its own work. It listens back to the narration, confirms the first frame carries the hook, verifies the video file, and lays out a contact sheet of every shot.
- action: goto url="/showcase.html#checks"
- action: highlight selector="[data-testid=check-transcript]"
- action: highlight selector="[data-testid=contact-sheet]"
- action: wait ms=1000

### SHOT install
- target: dashboard
- narration: To make one for your own app, add it to Claude Code as a plugin, or run it from a terminal. The video you just watched made itself.
- action: goto url="/showcase.html#install"
- action: highlight selector="[data-testid=install-plugin]"
- action: wait ms=1500
