# How to Use Claude Cowork on Windows

### SHOT 01-cold-open
- target: prebaked
- clip: 01-cold-open.mp4
- fullBleed: true
- narration: This organized folder and this index spreadsheet, with working formulas, started as forty loose files in a Downloads folder. Claude Cowork did the whole thing, on Windows. No Mac required, no terminal, no workarounds. Here is exactly how to set it up today.

### SHOT 02-roadmap
- target: prebaked
- clip: 02-roadmap.mp4
- fullBleed: true
- narration: This tutorial installs Claude Cowork on a Windows PC, covers the two setup traps, and runs a real task on real local files. Then you will see whether Cowork runs on your machine or in the cloud. Four steps, captured live on Windows 11.

### SHOT 03-setup
- target: prebaked
- clip: 03-setup.mp4
- fullBleed: true
- narration: You need three things: a paid Pro, Max, Team, or Enterprise plan; Windows 10 or higher; and admin rights for the installer. Cowork is not on the free plan. You do not need developer tools, a terminal, or WSL.

### SHOT 04-install-it-right
- target: prebaked
- clip: 04-install-it-right.mp4
- fullBleed: true
- narration: Step one. Install it right the first time, because two Windows settings decide whether Cowork shows up at all. Open your browser and go to claude.com slash download. Grab the Windows app and run the installer. Trap one arrives immediately: Windows pops a User Account Control prompt asking for administrator approval. Say yes. Anthropic is explicit about this one: without admin rights, Claude still installs and chat works fine, but Cowork on desktop is simply not available. If your company manages your machine, this admin install is the one thing to ask IT for. Once it is in, launch Claude from the Start menu and sign in with your paid account. Now trap two. Cowork does its heavy lifting inside a protected environment, and on Windows that requires a system feature called Virtual Machine Platform. If Cowork asks for it, here is the fix. Open Start, type turn Windows features on or off, tick Virtual Machine Platform, and hit OK. Prefer one line of PowerShell instead? The exact command is on screen and in the description. Either way, the feature only takes effect after a restart, so actually restart. Back at your desktop, open Claude and look at the message box. Bottom left: Chat, and right there beside it, Cowork. Claude Cowork is now live on this Windows machine.

### SHOT 05-first-real-task
- target: prebaked
- clip: 05-first-real-task.mp4
- fullBleed: true
- narration: Step two. A real job, on real files, not a demo prompt. Here is my test folder: about forty files of pure Downloads chaos. Screenshots, exported notes, PDFs, duplicates. In Claude, switch the selector to Cowork. First, connect the folder. This matters: Cowork reads and writes only in folders you connect. It does not get your whole drive. Now describe the outcome, not the steps. I typed: go through every file in this folder, organize everything into sensible subfolders, and build me an index spreadsheet with one row per file, its new location, and category counts with working formulas. Hit enter and watch. Claude writes a plan first, and you can see every step before and while it works. On bigger jobs it can even split the work into parallel subtasks. Permission behavior follows the mode you choose. In Manual mode, Cowork pauses and asks; you approve or deny. Auto and Skip can move with fewer prompts, so choose the mode to match the stakes. You are the supervisor here, not the typist. While it runs, watch File Explorer: subfolders appear as Claude works. You can see what it is planning and doing the whole way through, and steer when it matters. Claude Cowork just turned forty loose files into a clean folder tree plus an index spreadsheet with live formulas. Spot check the totals; you are still the reviewer. The sorting job is done.

### SHOT 06-where-it-runs
- target: prebaked
- clip: 06-where-it-runs.mp4
- fullBleed: true
- narration: Step three. Here is the hidden part: that job may not have run on your PC at all. As of July 2026, Cowork runs sessions remotely by default. The rollout is gradual. The thinking and code execution happen in an isolated, temporary environment on Anthropic's servers, and your sessions and files are saved to your Claude account. One: close your laptop, and the work keeps going. Two: scheduled tasks can run with no device online at all. Three: the desktop gate limits access, not data residency. A remote session reaches this computer only through the Claude Desktop app and only in folders you connect. When Claude opens a local file, its contents are processed on Anthropic's servers. Close the app and the session keeps running, but it loses access to those files. When Cowork executes locally on Windows, the code runs inside an isolated Linux virtual machine under Hyper-V, walled off from Windows itself. That is why the installer wanted Virtual Machine Platform. Caution: Anthropic's own safety guidance says keep genuinely sensitive files, like financial documents, out of connected folders. Give Cowork what an assistant needs, not everything you have. Watch: Claude Cowork keeps working with this laptop closed, because the session lives on Anthropic's servers, not on the PC.

### SHOT 07-anywhere-on-a-schedule
- target: prebaked
- clip: 07-anywhere-on-a-schedule.mp4
- fullBleed: true
- narration: Step four. Your desktop is now the anchor, not the cage. Because sessions live with your account, you can pick them up anywhere. On the web, go to claude dot ai, open the Home tab, and there is the same message box, the same Cowork selector, and the same session still running. On your phone, the latest Claude app for iOS or Android has it too. Start a task at your desk, steer it from the couch, answer a question Claude sends you on the go. When the work finishes, or Claude needs your input, your phone gets a notification. Local-file access still goes through the desktop app. If Claude needs a connected folder while you are away, the app has to be open on that computer. This scopes what Claude can reach; files it opens are still processed on Anthropic's servers. Last move: put it on a schedule. Mine is weekly: every Monday morning, compile a short digest of the week's AI announcements from sites I trust and save it as a document. Scheduled tasks run remotely, no device online. You can run a saved task on demand too, which is how I will prove it right now. I ran it once on demand, and there is the digest, in the session, on every device I own. That is Claude Cowork on Windows: installed, tasked, trusted with exactly what you chose, and working while you are not.

### SHOT 08-recap
- target: prebaked
- clip: 08-recap.mp4
- fullBleed: true
- narration: Quick replay. One: install with admin approval, enable Virtual Machine Platform, and restart. Two: connect only the folder you need, describe the outcome, and review the result. Three: sessions run remotely by default; Desktop scopes local-file access, but opened contents are processed on Anthropic's servers. Four: continue on web or phone, and schedule work with no device online. Forty messy files went in. A working system came out.

### SHOT 09-next
- target: prebaked
- clip: 09-next.mp4
- fullBleed: true
- narration: Factory AI at Work helps professionals get real output from AI, with claims checked against primary docs and receipts in the description. Every video is a real run on a real machine. Subscribe for the next tutorial: Teach Claude a Skill, start to finish.
