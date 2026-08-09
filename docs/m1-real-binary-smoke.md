# M1 real-binary smoke evidence

## Environment

- GUI commit: `2281452`
- bingo binary: `/Users/yexrob/Episodes/Projects/bingo/.bingo/worktrees/feat/gui-json-events/target/debug/bingo`
- bingo version: `0.3.3`
- protocol: `1`

## AC-F2-1 / AC-F2-2 initial real turn

Prompt:

```text
Reply with exactly Hello from bingo
```

Observed in the real Electron renderer:

- The user message appeared immediately.
- The assistant response rendered as `Hello from bingo`.
- The composer returned to idle and was enabled for another prompt.
- The turn used the persistent worktree `bingo --json-events` child, not a fixture.

This proves the basic GUI → IPC → `turn.start` → `turn.started` / `text.delta` / `turn.completed` → reducer/render path. Precise first-token timing and independent `--print` parity remain for QA instrumentation.

## Integration fix discovered before smoke

The renderer subscription previously depended on `state.turnId`, causing unsubscribe/resubscribe churn during active turns and a window where events could be lost. Commit `2281452` keeps the subscription stable and reads the active turn ID from a ref while preserving connection, sequence, and turn guards.

## Remaining M1 acceptance

Not yet claimed: tool activity/prompt response, cancel/late-event behavior, Markdown injection matrix, structured error recovery, multi-turn continuity, new-conversation isolation, and timing/parity measurements.
