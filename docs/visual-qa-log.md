# Visual QA log

Findings from gui-vision screenshot reviews, one section per review round.
Severity: critical / major / minor / nit. Criticals block the milestone; others go to the
polish backlog (M3) unless marked otherwise.

## Round 1 — M0 error states (2026-08-10)

Screenshots: `docs/screenshots/m0-protocol-unsupported.png`, `docs/screenshots/m0-missing-binary.png`

**Gate: PASS** (no critical / major; minors + nits tracked to M3).

### Minor
1. Secondary-text contrast below WCAG AA: sidebar `Conversations` label and bottom runtime
   status (`App 0.1.0 / bingo unavailable`) are light gray on off-white. Raise secondary text
   to ≥ 4.5:1; do not rely on low contrast alone to express "unavailable".
2. Long error paths lack proven wrapping: current paths (~304 px) fit, but detail area width is
   ~540 px. Use `overflow-wrap: anywhere` (or equivalent) and verify with a >100-char path
   screenshot.
3. Error block centers off: block starts at x≈1350 in a ~740 px content area; visually left-ish.
   If error states are meant centered, anchor to the content area, not a fixed left margin; both
   states must share one anchor.

### Nit
1. Vertical anchor differs ~13 px between the two error states (eyebrow y=375 vs y=388) — likely
   capture-time layout variance; use one fixed container alignment to avoid state-switch jump.
2. `BINGO_PROTOCOL_UNSUPPORTED` badge (~229×27 px) vs `BINGO_NOT_FOUND` (~139×27 px): fine at this
   size; keep equal height, width-adaptive, wrapable in narrow windows.
3. Retry button looks correct (78×46 px, dark on white, ≥44×44 hit target) but static screenshots
   cannot prove clickability — interaction test required (focus, hover, pressed, disabled,
   loading states).

## Round 2 — M1 chat-loop states (2026-08-10)

Screenshots: `docs/screenshots/m1/ac-f2-3-running.png`, `ac-f2-3-tools.png`,
`ac-f2-5-cancel.png`, `ac-f2-7-error.png`, `ac-f3-2-new-conversation.png`.

**Gate: PASS** (after fixes; no Critical/Major remaining).

### Fixed in this round (commit 1870a6e + a77e0ae)
1. `BINGOInterrupted` concatenation: assistant interrupted/error status is now
   a distinct pill badge on its own line (`.message > small`).
2. Timeline `scroll-padding-top` so a scrolled-into-view message is not flush
   under the header divider.
3. Tool `running` state capture added (mid-flight `sleep 18` tool row).

### Verified by gui-vision (final)
- `INTERRUPTED` badge visible on its own line, clear vertical gap from the
  role label; the cancelled tool row shows `interrupted` next to a prior
  `done` row; no clipping/overflow on messages, tool rows, composer, or Send.

### M3 backlog (carried)
- Secondary-text contrast ≥ 4.5:1 (done/error tool status gray-on-gray).
- Inline code block horizontal scrollbar affordance.
- Error "fix-command" typography.
- Long-path wrapping >100 chars; error-state vertical anchor consistency.
