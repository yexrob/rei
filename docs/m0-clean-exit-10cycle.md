# M0 clean-exit 10-cycle evidence

- Binary: `/Users/yexrob/Episodes/Projects/bingo/.bingo/worktrees/feat/gui-json-events/target/debug/bingo`
- Deadline: Electron and its bingo descendant gone within 3 seconds after normal window close.

| Cycle | App PID | bingo child PID | Close time | Electron gone | Child gone | Result |
|---:|---:|---:|---|---|---|---|
| 1 | 6981 | 7037 | 2026-08-09T19:23:54Z | yes | yes | PASS |
| 2 | 7092 | 7150 | 2026-08-09T19:23:55Z | yes | yes | PASS |
| 3 | 7229 | 7259 | 2026-08-09T19:23:56Z | yes | yes | PASS |
| 4 | 7341 | 7371 | 2026-08-09T19:23:57Z | yes | yes | PASS |
| 5 | 7451 | 7507 | 2026-08-09T19:23:59Z | yes | yes | PASS |
| 6 | 7566 | 7620 | 2026-08-09T19:24:00Z | yes | yes | PASS |
| 7 | 7699 | 7728 | 2026-08-09T19:24:01Z | yes | yes | PASS |
| 8 | 7804 | 7833 | 2026-08-09T19:24:02Z | yes | yes | PASS |
| 9 | 7921 | 7951 | 2026-08-09T19:24:03Z | yes | yes | PASS |
| 10 | 8077 | 8139 | 2026-08-09T19:24:05Z | yes | yes | PASS |

**Result: PASS — 10/10 cycles left no Electron or bingo descendant after the 3-second deadline.**
