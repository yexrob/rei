# AC-F2-3 real tool activity

- Real bingo worktree binary was used.
- Prompt: `Use Bash to run uname -a and report the exact output.`
- Raw events: `ac-f2-3-uname.ndjson`.
- Diagnostics: `ac-f2-3-uname.stderr`.
- GUI capture: `../screenshots/m1/ac-f2-3-tools.png`.
- `tool.ready` seq 3 and `tool.done` seq 4 share `toolCallId=call_00_BBnoWYFIrizJwJdH2Twc7788`.
- Tool name/summary are `Bash` / `$ uname -a`; terminal status is `done` and duration is 10ms.
- The renderer displays one activity row keyed by that toolCallId; no transport tool was omitted.

## Failing tool after adapter fix 0946d95

- Raw events: `ac-f2-3-tool-error-fixed.ndjson`.
- `tool.ready` and `tool.done` share `toolCallId=call_00_cU7rgqhJMWjVemWz2t9Z7804`.
- Command: `sh -c "exit 7"`.
- `tool.done.status` is now `error`; output records exit code 7.
- The earlier defect recorded by commit `8fab477` is resolved by the rebuilt worktree binary.

The `BINGO_GUI_E2E_PROMPT` path in `src/main/index.ts` is evidence-only and gated by both an explicit environment variable and `!app.isPackaged`. It is not reachable in packaged production builds and will be removed after the evidence matrix is complete.

## Update (CSS fix re-capture)
- `../screenshots/m1/ac-f2-3-running.png` added: same tool turn captured mid-flight (tool row `running`).
- `../screenshots/m1/ac-f2-3-tools.png` re-captured after the status-badge/scroll-padding CSS fix.
