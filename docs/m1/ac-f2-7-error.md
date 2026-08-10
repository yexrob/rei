# AC-F2-7 structured turn error

The real bingo process was started with `--model qa-definitely-invalid-model`, accepted a turn, then emitted:

- `error.scope = "turn"`
- `code = "AUTH_REQUIRED"`
- a sanitized `msg` identifying the unsupported model
- `recoverable = true`

Raw records are in `ac-f2-7-error.ndjson`; diagnostics are in `ac-f2-7-error.stderr`. The GUI reducer maps a turn-scoped error to its inline error region and settles the active turn back to idle, so the composer remains usable without replacing the child. Focused reducer tests cover that state transition, but PID-stability and GUI screenshot evidence are still pending.

## Update (GUI screenshot)
- `../screenshots/m1/ac-f2-7-error.png` added: AUTH_REQUIRED inline error card + interrupted status badge, captured via the app capturePage pipeline.
