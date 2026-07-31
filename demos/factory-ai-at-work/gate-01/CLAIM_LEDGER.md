# Gate 1 Claim Ledger

Verified against live primary documentation: 2026-07-30.

This ledger covers factual product claims in the master and three cuts. A live
capture is still required for every statement about what happened in Dan's
specific run.

## Primary sources

- S1: https://support.claude.com/en/articles/10065433-install-claude-desktop
- S2: https://support.claude.com/en/articles/12622703-deploy-claude-desktop-for-windows
- S3: https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork
- S4: https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile
- S5: https://support.claude.com/en/articles/13364135-use-claude-cowork-safely
- S6: https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview
- S7: https://support.claude.com/en/articles/12138966-release-notes

## Product claims

| ID | Claim used in narration | Source |
|---|---|---|
| C1 | Cowork is available on paid Pro, Max, Team, and Enterprise plans, not Free. | S1, S3 |
| C2 | Claude Desktop supports Windows 10 or higher and launches from the Start menu. | S1 |
| C3 | Full-feature individual Windows installation, including desktop Cowork, requires administrator privileges and shows UAC; chat can still install without desktop Cowork. | S2 |
| C4 | Windows desktop Cowork requires Virtual Machine Platform; the shown PowerShell command enables it and a restart is required. | S2 |
| C5 | Chat and Cowork share the message box, with Cowork selected at the bottom left. | S3, S4 |
| C6 | Cowork brings Claude Code agentic capabilities to a visual interface without requiring a terminal. | S1, S3 |
| C7 | Desktop local-file access is limited to connected folders rather than the whole drive. | S1, S3, S4, S6 |
| C8 | Cowork can organize files and produce Excel spreadsheets with working formulas. | S1, S3 |
| C9 | Cowork creates a plan, can break complex work into subtasks, coordinates parallel work when appropriate, and shows progress so the operator can steer. | S3 |
| C10 | Permission behavior depends on Manual, Auto, or Skip mode; Manual pauses for approval, while Auto and Skip can move with fewer prompts. | S3 |
| C11 | Sessions run remotely by default in beta, with agent work and code execution in an isolated environment on Anthropic servers and session files saved to the Claude account. | S3, S4, S5, S6 |
| C12 | Remote work continues after the laptop closes; scheduled tasks run with no device online. | S3, S4, S7 |
| C13 | A remote session reaches local files through the open Claude Desktop app, only in connected folders. Contents Claude opens through Desktop are processed on Anthropic's servers. Closing the app ends that local-file access, not the remote session. | S3, S4, S5, S6 |
| C14 | In a local Windows session, code runs inside a Linux VM isolated with Hyper-V. | S6 |
| C15 | Anthropic recommends limiting connected folders and avoiding sensitive material such as financial documents, credentials, and personal records. The desktop gate scopes access; it is not a data-residency boundary. | S5 |
| C16 | Cowork is available on web and current iOS and Android apps; the same remote session can be opened across desktop, web, and mobile. | S3, S4, S7 |
| C17 | Phone notifications arrive when a Cowork task finishes or needs input. | S4 |
| C18 | Scheduled tasks can run automatically or on demand. | S3 |
| C19 | Cowork has internet and browser capabilities, subject to network policy, so a low-risk web digest is a supported task shape. | S3, S5 |
| C20 | The July 7, 2026 release added web and mobile remote sessions and changed the device-continuation model described in the tutorial. | S7 |
| C21 | No Mac is required because Windows is an officially supported Cowork surface. | S1, S3 |
| C22 | No WSL or developer tooling is listed in the official Windows Cowork requirements. This is an inference from the complete published requirements, not a vendor quote. | S1, S2 |

## Run-dependent receipts

| ID | Capture-dependent statement | Required proof |
|---|---|---|
| R1 | The source folder contains about forty loose, non-sensitive files. | File inventory and exact count from the captured run. |
| R2 | The spoken task matches what was entered. | Captured prompt text and saved task receipt. |
| R3 | A permission prompt appears in the visual. | Actual prompt from the selected approval mode; remove the visual if none appeared. |
| R4 | Subfolders appear and the final spreadsheet has working formulas. | Before and after folder inventory plus formula-cell spot checks. |
| R5 | Work progresses after the laptop closes. | Real timestamps from the original session and the second device. |
| R6 | The same session is shown on desktop, web, and phone, including a notification. | Captures from all three surfaces tied to the same task. |
| R7 | The scheduled digest ran on demand and produced the shown document. | Scheduled-task history and output artifact. |
| R8 | Every video here is a real run on a real machine. | Rights-clean source inventory and production receipt for every shot. |

## Drift disposition

The 2026-07-26 source script said Cowork asks whenever it needs a permission and
the operator approves or denies. Current S3 documents three permission modes,
including modes that do not pause for every action. The production manifests
therefore use mode-specific wording. No broader permission guarantee survives.

Before the real-voice render, re-open S1 through S7. Any changed claim is
rewritten or cut before recording; a stale source date is not a waiver.
