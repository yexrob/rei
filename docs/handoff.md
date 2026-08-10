# bingo-gui — handoff & usage

An Electron desktop GUI for the `bingo` Rust agent CLI. Chat with the agent,
watch every tool run, manage sessions, switch provider/model/thinking, edit
settings (user layer only), in light or dark.

## Launch

```bash
cd /Users/yexrob/Episodes/Projects/bingo-gui
BINGO_GUI_BINARY=/Users/yexrob/Episodes/Projects/bingo/.bingo/worktrees/feat/gui-json-events/target/debug/bingo npm run dev
```

`BINGO_GUI_BINARY` must point at the protocol-v1 binary (the worktree build);
the main-checkout 0.3.3 does not support `--json-events` and the app shows a
protocol-unsupported state. `npm install` is already done; Electron is fixed.

## What works (verified end-to-end)

- Chat loop: send → streamed markdown reply (first token < 5s), tool activity
  rows (`running → done|error|interrupted`), cancel with 1s recovery, inline
  structured errors (child process survives, input stays usable).
- Sessions: sidebar list (newest-first, first-message titles, clean previews),
  restore, rename, delete (bingo-owned, confirm dialog).
- Runtime: provider/model/thinking switcher backed by the adapter's
  `providers.list` (default → built-ins → user-defined) and `models.list`.
- Settings: layered snapshot, user-layer-only atomic writes with backup and
  unknown-key preservation; save disabled when clean; "Saved" toast.
- Themes: dark/light following the bingo `theme` setting (auto → system).
- Feedback: 200ms thinking indicator, error focus + aria-live, empty states.

## Status

M0 launch, M1 chat loop, M2 sessions+settings, M3 polish: **implemented and
verified** (31 vitest, 852+12 Rust tests, typecheck, build, live smoke).
The visual gate (gui-vision review of the dual-theme matrix in
`docs/screenshots/m3/`) is pending the `road` provider's recovery from
intermittent overload; everything else is complete.

## Notes

- The real `~/.config/bingo/settings.json` currently has `provider:
  opencode-go` (not authenticated) — the switcher surfaces it; switch to
  `default` or log in to opencode-go before relying on turns.
- `docs/` holds the full paper trail: PRD, architecture (protocol v1), CLI
  facts, acceptance checklist, per-milestone evidence, visual QA log.
- The bingo-side `--json-events` work lives in the bingo worktree branch
  `feat/gui-json-events` (probe/inspect/session loop/tool IDs, all green).
