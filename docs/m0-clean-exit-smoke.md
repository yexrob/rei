# M0 clean-exit smoke evidence

- Scenario: launch with `BINGO_GUI_BINARY=/definitely/missing/bingo-m0-exit`, then close the only window normally.
- Baseline `pgrep -fl bingo`: PID 28286 (`bingo --permission-mode bypassPermissions`), an unrelated pre-existing process.
- During the M0 probe: no additional persistent `bingo` process existed. The missing override fails before spawn.
- Electron main PID 16146 and its helper processes were running before close.
- Normal window close terminated Electron within 1 second.
- The `npm run dev` command exited with status 0.
- Post-close `pgrep -fl bingo`: only the same pre-existing PID 28286 remained.
- Conclusion: the M0 app left no bingo child or Electron helper process orphaned.
