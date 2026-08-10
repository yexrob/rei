# AC-F2-1 / AC-F2-2 evidence (first-token timing, streaming, --print parity)

Driven through the real Electron renderer via CDP on an isolated config
(`HOME=/tmp/m1home`, provider default/deepseek, model deepseek-v4-flash;
binary = worktree `target/debug/bingo`). A `text.delta` listener was installed
before submit; `performance.now()` timestamps submit (click) and the first
non-empty delta.

## AC-F2-1 — first token timely (3 repeats)

| Run | Prompt sentinel | First delta after submit | Deltas this turn | DOM result |
|---|---|---|---|---|
| 1 | F2PARITY_42 | **1134 ms** | 6 | assistant rendered `F2PARITY_42` |
| 2 | F2PARITY_43 | **1374 ms** | 12 | assistant rendered `F2PARITY_43` |
| 3 | F2PARITY_44 | **878 ms** | 18 | assistant rendered `F2PARITY_44` |

Each submit created exactly one immediate user row; the composer disabled
during the turn and re-enabled on completion. All first tokens ≤ 5 s
(AC-F2-1 pass threshold).

## AC-F2-2 — progressive stream and --print parity

- **Progressive:** each run produced multiple ordered deltas (6 / 12 / 18),
  appended only, matching the "at least two non-empty updates before
  completion" requirement.
- **Parity:** same isolated config, same prompt sentinel:

  - GUI streamed text (delta concat): `F2PARITY_42`
  - `bingo --print "Reply with exactly: F2PARITY_42"` stdout: `F2PARITY_42`

  Byte-identical final text — protocol invariant 4 (text.delta concatenation
  equals `--print` output for the same prompt) holds against the real binary.

## Notes

- The per-run `joinedText` in the raw probe accumulated across runs because
  one listener was installed; the per-turn DOM text is the per-run truth.
- First-token timing is renderer-side (submit click → first delta event);
  transport overhead included, matching the AC's "first token arrives" scope.
