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

## Round 3 — M2 sessions & settings (2026-08-10)

Screenshots: `docs/screenshots/m2/session-list.png`, `settings-page.png`.

**Gate: BLOCKED (3 Major) → M3 scope.**

### Major (M3 fix list)
1. No persistent selected state for the active nav item / current session
   (nav buttons and session entries look identical; add accent/indicator +
   `aria-current`, not hover-only).
2. Provider selector label truncated even at ~2000 px width
   (`opencode-go · built-in · r…`); show the provider name fully, move
   metadata (builtin/credential) to secondary text/tooltip.
3. No narrow-window evidence; the top control group (~650 px) and the
   two-column settings form cannot fit 800×600 (≈467 px content). Reflow to a
   second row / single column and provide 800×600 screenshots.

### Minor (M3 backlog)
- Session hierarchy: use the first user message as the title, highlight the
  current session, group by day; the 681 counter should not carry hierarchy.
- Preview normalization: plain text, single-line ellipsis, no raw Markdown in
  the nav.
- Settings save states: disabled when clean, in-progress on save, feedback
  near the button (dirty/saving/saved/error).
- Distinguish "global default" fields from "current provider" details.
- Save action stickiness for scrollable settings content (sticky header/footer).
- Native blue checkbox (`Send images`) vs the black/cream palette — unify in M3.

## Round 4 — M3 dual-theme matrix: final gate (2026-08-11)

`docs/screenshots/m3/{light,dark}/*` (10 files). Independent review
(vision-final-4) after two fix cycles:

**Gate: PASS — no Critical/Major.**

Fixed in this round (and their root causes):
1. Dark theme never applied → `RuntimeSettings` contract lacked the `theme`
   field, so the renderer always resolved auto/light; theme now flows from
   session metadata on read/save (2a2de37, 260e643) and is applied on
   `<html>` (5962264). Verified live: `htmlTheme="dark"`, sidebar
   `rgb(21,20,17)`.
2. Right-edge clipping of Apply/Send at 1440x900 → chat-header now
   `flex-wrap` at any width (cf88d28).
3. 800x600 horizontal overflow → header wrap + `overflow-wrap:anywhere` on
   error cards; re-captured chat/settings at 800x600.
4. Loading state evidence → captured mid-tool-turn (tool row running,
   Cancel visible), distinct from the completed chat capture.
5. Selected states → 3px accent bar on active nav/session row; verified live
   (`::before` present, `activeRows=1`).

Also fixed while reproducing: dark captures previously identical to light
because `auto` resolved to the system's Dark appearance while the contract
never carried theme; the light chat capture uses an isolated HOME with the
real transcripts symlinked (707 sessions) so history renders in true light.
