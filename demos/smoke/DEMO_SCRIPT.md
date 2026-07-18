# Smoke demo

### SHOT intro
- target: dashboard
- narration: This is the smoke fixture for the screencast capture engine, showing chapters, highlights, and crisp text.
- action: goto url="/fixture.html"
- action: chapter label="Screencast smoke"
- action: highlight selector="#go"
- action: wait ms=800

### SHOT interact
- target: dashboard
- narration: The cursor travels to the field, types a name, and clicks the button, while the camera eases in on the action.
- action: goto url="/fixture.html"
- action: type selector="#name" text="Ada"
- action: click selector="#go"
- action: wait ms=1200

### SHOT scroll
- target: dashboard
- narration: Finally, a smooth scroll glides down to the details card far below the fold.
- action: goto url="/fixture.html"
- action: scroll selector="#details"
- action: wait ms=800
