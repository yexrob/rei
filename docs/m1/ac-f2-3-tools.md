# AC-F2-3 real tool activity

- Real bingo worktree binary was used.
- Prompt: `Use Bash to run uname -a and report the exact output.`
- Raw events: `ac-f2-3-uname.ndjson`.
- Diagnostics: `ac-f2-3-uname.stderr`.
- GUI capture: `../screenshots/m1/ac-f2-3-tools.png`.
- `tool.ready` seq 3 and `tool.done` seq 4 share `toolCallId=call_00_BBnoWYFIrizJwJdH2Twc7788`.
- Tool name/summary are `Bash` / `$ uname -a`; terminal status is `done` and duration is 10ms.
- The renderer displays one activity row keyed by that toolCallId; no transport tool was omitted.

The `BINGO_GUI_E2E_PROMPT` path in `src/main/index.ts` is evidence-only and gated by both an explicit environment variable and `!app.isPackaged`. It is not reachable in packaged production builds and will be removed after the evidence matrix is complete.
