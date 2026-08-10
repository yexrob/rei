# AC-F2-7 GUI-layer structured error evidence

Phase 1 and 2 were driven through the real Electron renderer via CDP
(`Runtime.evaluate`): a turn was submitted from the composer, then the DOM was
polled. Environment: `HOME=/tmp/m1home` (isolated config), binary =
worktree `target/debug/bingo` (0.3.3, protocol v1).

## Phase 1 — turn error is rendered inline, child survives, input stays usable

Config: `provider: "opencode-go"` (built-in preset, **not authenticated**) —
the current user settings had switched the top-level provider to opencode-go,
so the isolated HOME inherited it. Submitting `Reply with exactly: TURN_OK`
produced a real turn-scoped error.

Observed DOM (polled after the turn):

- `.inline-error` region rendered: `AUTH_REQUIRED` + message
  (`provider "opencode-go" …` — sanitized single-line msg).
- Assistant block settled as interrupted; no crash, no flow-level screen.
- Composer: `textarea disabled=false` (input usable for the next prompt),
  Send enabled — the turn error does not lock the UI.
- Child PID before the turn and after the error: **same PID `58415`**
  (persistent child is not respawned on a turn error).

This matches the transport evidence in `ac-f2-7-error.ndjson` (fcb867a:
`error.scope=turn`, `code=AUTH_REQUIRED`, `recoverable=true`) — the GUI maps a
turn-scoped error to the inline region and settles the turn back to idle.

## Phase 2 — recovery: config fixed → next turn succeeds

Config fixed in the isolated HOME: `provider: "default"` (deepseek, key
present), `model: deepseek-v4-flash`. Relaunched the app (same binary), sent
the same prompt:

- Assistant streamed `TURN_OK` and rendered as a completed message.
- Composer returned to idle, enabled for the next prompt.

## Scope notes

- The M1-provable guarantees: inline turn error with code/msg, no child
  respawn on turn errors, input usable afterwards, app-level recovery after a
  configuration fix (no app restart beyond the config change itself).
- Changing the model/provider **inside the running app** is the M2 settings
  flow (AC-F4-5: settings save restarts the child on the same session) —
  there is no settings UI in M1. The same-child-next-turn-success after a
  *transient* error (e.g. rate limit) is covered by the protocol contract
  (turn errors leave the child alive and idle) and the 12 black-box tests.
