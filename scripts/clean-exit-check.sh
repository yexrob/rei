#!/bin/bash
set -euo pipefail

ROOT=/Users/yexrob/Episodes/Projects/bingo-gui
BINARY=/Users/yexrob/Episodes/Projects/bingo/.bingo/worktrees/feat/gui-json-events/target/debug/bingo
ELECTRON="$ROOT/node_modules/.bin/electron"
REPORT="$ROOT/docs/m0-clean-exit-10cycle.md"

printf '# M0 clean-exit 10-cycle evidence\n\n' > "$REPORT"
printf -- '- Binary: `%s`\n- Deadline: Electron and its bingo descendant gone within 3 seconds after normal window close.\n\n' "$BINARY" >> "$REPORT"
printf '| Cycle | App PID | bingo child PID | Close time | Electron gone | Child gone | Result |\n|---:|---:|---:|---|---|---|---|\n' >> "$REPORT"

for cycle in $(seq 1 10); do
  BINGO_GUI_BINARY="$BINARY" "$ELECTRON" "$ROOT" >/tmp/bingo-gui-cycle-$cycle.log 2>&1 &
  launcher=$!
  app_pid=''
  child_pid=''
  for _ in $(seq 1 100); do
    app_pid=$(pgrep -P "$launcher" -f 'Electron.app/Contents/MacOS/Electron' | head -1 || true)
    [[ -z "$app_pid" ]] && app_pid=$launcher
    child_pid=$(pgrep -P "$app_pid" -f "$BINARY --json-events" | head -1 || true)
    [[ -n "$child_pid" ]] && break
    sleep 0.1
  done
  if [[ -z "$child_pid" ]]; then
    kill "$launcher" 2>/dev/null || true
    printf '| %s | %s | — | — | — | — | FAIL: child not observed |\n' "$cycle" "$app_pid" >> "$REPORT"
    exit 1
  fi

  close_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  osascript -e 'tell application "System Events" to tell process "Electron" to click button 1 of window "bingo"' >/dev/null
  electron_gone=no
  child_gone=no
  for _ in $(seq 1 30); do
    kill -0 "$app_pid" 2>/dev/null || electron_gone=yes
    kill -0 "$child_pid" 2>/dev/null || child_gone=yes
    [[ "$electron_gone" == yes && "$child_gone" == yes ]] && break
    sleep 0.1
  done
  result=PASS
  [[ "$electron_gone" == yes && "$child_gone" == yes ]] || result=FAIL
  printf '| %s | %s | %s | %s | %s | %s | %s |\n' "$cycle" "$app_pid" "$child_pid" "$close_time" "$electron_gone" "$child_gone" "$result" >> "$REPORT"
  [[ "$result" == PASS ]] || exit 1
  wait "$launcher" 2>/dev/null || true
done

printf '\n**Result: PASS — 10/10 cycles left no Electron or bingo descendant after the 3-second deadline.**\n' >> "$REPORT"
