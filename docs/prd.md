# bingo-gui v0.1 — Product Requirements Document

> Status: draft · Owner: pm (gui-pm) · Audience: architect (gui-arch), developer (gui-dev), QA (gui-qa)
> Source of truth for the CLI side: `/Users/yexrob/Episodes/Projects/bingo` (read-only reference; **do not modify**).
> Every acceptance criterion is numbered `AC-<F#>-<n>`; QA turns these into a checklist verbatim.

## 1. Summary

bingo-gui is a desktop GUI (Electron) for the `bingo` Rust agent CLI. It drives bingo (as a
subprocess — exact mechanism is the architect's decision) to give a chat-first agent experience:
send a prompt, watch the response stream in, see every tool the agent runs, switch model/provider,
and keep multiple named conversations.

**v0.1 delivers one thing done well: a reliable chat loop with the agent** — plus the
configuration and session management needed to use it day-to-day. Everything beyond that is a
non-goal (see §5).

## 2. Ground truth: what the CLI offers (integration surface)

Verified facts from the bingo source (paths relative to `/Users/yexrob/Episodes/Projects/bingo`).
The GUI builds on these; the architect designs against them.

| # | Contract | Fact |
|---|---|---|
| C1 | Headless run | `bingo --print "prompt"` runs one query; **text deltas stream to stdout** (`src/query.rs:310` `headless_hooks`, `StreamEvent::TextDelta`). |
| C2 | Tool events in headless | **Not exposed.** `on_tool_ready`/`on_tool_done` are no-ops in headless mode (`src/query.rs:315`). Tool activity currently appears only in the TUI. |
| C3 | Error contract | Non-TTY failure prints `[error] code=<SCREAMING_SNAKE> msg=<single line ≤200 chars>` to **stderr**, exit code **1**; success is exit **0** (`src/main.rs:530-540`). |
| C4 | Settings file | JSON at `~/.config/bingo/settings.json` (user layer; project/local layers also exist). Keys: `apiKey`, `apiBaseUrl`, `providers{<name>:{apiBaseUrl, apiKey, supportsImages, …}}`, `provider`, `model`, `sendImages`, `thinkingLevel` (`off|low|medium|high|xhigh|max`), `permissionMode`, `theme` (`auto|dark|light`), `motion`, `mcpServers`, `experimental`, `team`, `hooks` (`src/settings.rs`). Unknown keys may exist; **writes must preserve them** (read-modify-write). |
| C5 | Session storage | Transcripts: JSONL, one Message per line, at `~/.local/share/bingo/transcripts/{slug}-{ts}.jsonl` (`src/transcript.rs:49-54`). `--continue` resumes the **most recent** session only; `/resume <name|keyword>` and `/rename` exist as TUI slash commands (`src/tui/slash.rs`). |
| C6 | Slash surface (config) | `/model [name]`, `/provider [name]`, `/think [level]`, `/permissions`, `/theme`, `/status`, `/config` (`src/tui/slash.rs:6-37`). |
| C7 | Ask/permission prompts | Headless mode prints the question to stderr and reads the answer from stdin (`src/query.rs:322-355`). |
| C8 | UI feedback conventions | bingo's feedback-states spec (`notes/design/feedback-states.md`, v1.18) defines: state machine `idle→loading→success/error→idle`, loading threshold **>200ms**, tiered timeouts (**10s reads / 15s writes** for short ops; **no short timeout on long agent turns**), toasts **3s, hover-pause, max 2**, errors in **3 levels** (field/page/flow), error copy = *what happened + what to do*, and stale-response race protection (abort/sequence-number). **The GUI must follow the same conventions** — QA cross-checks both surfaces against the spec. |
| C9 | Process model | One `bingo` invocation = one query run. Multi-turn chat means either one long-lived process or repeated invocations with session continuity — an architect decision (see §6). |

### Constraints the GUI inherits

1. **Single writer for transcripts and settings.** The GUI reads transcripts (session list,
   history) but never writes them; bingo (or the user) owns that storage. For settings, the GUI
   may write the **user layer** settings file, atomically, preserving unknown keys.
2. **bingo is read-only for this project.** Any need to change the CLI contract (§6 Q1) is an
   upstream proposal for the user to approve — never silently assumed.
3. **User-facing copy is English** (project rule, applies to the GUI too).

## 3. Product scope — features and acceptance criteria

### F1 — App shell & launch

An Electron window opens, the bingo binary is located, and the app reports its state honestly.

- **AC-F1-1** The app launches from the documented dev command; a window opens within 10s and
  shows the app version and the bingo CLI version in a visible status area.
- **AC-F1-2** When the bingo binary cannot be found (missing on PATH / invalid configured path),
  the app shows a **flow-level error** naming the exact path tried, with a Retry action; the app
  does not crash and does not open a broken chat.
- **AC-F1-3** The window resizes down to 800×600 without overlapping controls or content
  clipping (scrollbars appear where needed).
- **AC-F1-4** Closing the window terminates all spawned bingo child processes within 3s — no
  orphaned processes after quit.

### F2 — Conversation UI (chat loop)

The core: send prompt → agent streams a reply → every tool the agent runs is visible.

- **AC-F2-1** Sending a prompt shows it as a user message immediately; on a healthy connection
  the first token of the reply appears within **5s** of send.
- **AC-F2-2** Reply text renders progressively (streamed), and the final rendered text matches
  `bingo --print "<same prompt>"` output for the same session state (determinism check).
- **AC-F2-3** Every tool invocation during a turn is visible in the activity stream with: tool
  name, short input summary, and status transitions `running → done | error`. **No tool call may
  be silently invisible.**
- **AC-F2-4** Duplicate-prevention at submit granularity: while a turn is running, Enter and the
  Send button both fail to submit a second prompt — exactly one send per action.
- **AC-F2-5** Cancel interrupts the current turn; the turn is visibly marked as interrupted; the
  app returns to idle and accepts the next prompt within 1s. A late response from a cancelled
  turn never overwrites the cancelled/interrupted state.
- **AC-F2-6** Assistant replies render Markdown (at minimum: headings, lists, bold, inline code,
  fenced code blocks). Reply content is escaped — no HTML/script injection from model output.
- **AC-F2-7** When the CLI exits non-zero, the turn shows an inline error carrying the `code=`
  and `msg=` from the `[error]` line (C3); the input stays usable for the next prompt.

### F3 — Session management

Multi-turn continuity within a conversation; multiple named conversations.

- **AC-F3-1** Consecutive turns in one conversation share context: a two-prompt script
  ("remember X" → "what was X?") succeeds without repeating the fact in the second prompt.
- **AC-F3-2** "New conversation" starts a fresh session — facts from the previous conversation
  are not visible to it.
- **AC-F3-3** (M2) A session list shows all past sessions: name, last-message preview,
  timestamp, sorted newest-first.
- **AC-F3-4** (M2) Resuming a session restores the full message history and context; the next
  turn continues where it left off.
- **AC-F3-5** (M2) Rename and delete exist; delete requires a confirmation dialog; a deleted
  session disappears from the list and its transcript is removed.
- **AC-F3-6** (M2) The GUI only **reads** transcript storage; a diff of the transcripts dir
  before/after a GUI session shows no files written by the GUI.

### F4 — Model & provider configuration

Choose what model the agent runs on, from bingo's own settings.

- **AC-F4-1** A provider/model switcher lists exactly the providers present in bingo's settings
  plus the `default` provider, marking the active one. The current model and thinking level are
  shown.
- **AC-F4-2** Changing provider/model/thinking level persists to the user-layer settings file
  such that a subsequent plain `bingo --print "hi"` run uses the new value (round-trip test).
- **AC-F4-3** An invalid model name produces a field-level error with a specific message (why
  invalid), does not write the bad value, and does not corrupt settings.
- **AC-F4-4** API keys are never shown in plain text anywhere in the UI (masked); keys are only
  ever written back to the settings file, never to logs or the renderer console.
- **AC-F4-5** Provider/model changes take effect on the next turn — no app restart required.

### F5 — Settings screen

View and edit the bingo configuration the GUI owns.

- **AC-F5-1** The settings screen loads and displays current effective values: endpoint(s),
  active provider, model, thinking level, permission mode, theme, image support.
- **AC-F5-2** Saving writes settings.json atomically and validly, preserving all unknown keys
  (read-modify-write). On validation failure the app shows the error and the old file is
  byte-identical (checksum before/after).
- **AC-F5-3** The pre-edit file is backed up (e.g. `settings.json.bak-<ts>`, consistent with
  bingo's own backup convention) before any write.
- **AC-F5-4** An unreadable/corrupt settings file at launch → flow-level error with the parse
  message and a path forward; the app does not crash and does not overwrite the corrupt file.
- **AC-F5-5** Every successful save shows a toast ("Saved"); toasts auto-dismiss after 3s,
  hover-pause, max 2 stacked (C8).

### F6 — States, error paths, polish

The feedback-states conventions (C8) applied to the GUI, plus empty states and resilience.

- **AC-F6-1** A loading indicator appears only after **>200ms** of an in-flight operation and
  clears when it completes; no fullscreen blocking overlay; page-level operations show a
  skeleton/spinner, button-level a spinner in place.
- **AC-F6-2** Every error message states what happened **and** what the user can do; dead-end
  copy ("operation failed") is forbidden.
- **AC-F6-3** Stale-response race: after cancel or retry, a late response from the old request
  is discarded (abort or sequence-number) and never flashes over newer state.
- **AC-F6-4** Empty states: no sessions → welcome screen with a primary "Start a new
  conversation" action; empty conversation → a hint on how to start; no rendering of broken/blank
  panels.
- **AC-F6-5** Killing the bingo child process mid-turn (simulated crash) → page-level error with
  Retry within 2s; the app recovers to idle without a full restart.
- **AC-F6-6** Keyboard & accessibility: Enter submits, Shift+Enter inserts a newline; error
  regions and toasts are in an `aria-live` region; the error element receives focus
  (asynchronously after render) on failure.
- **AC-F6-7** Visual QA: dark and light states (following bingo's `theme` setting) pass a
  screenshot review (vision agent) for chat, empty, loading, and error states — no layout
  breakage, readable contrast.

## 4. Milestones

Entry/exit criteria per milestone. A milestone is done only when **its** exit criteria pass
(gates do not accumulate silently).

### M0 — Scaffold: the app launches
- **Entry:** GUI repo initialized (done); architect's stack/architecture decision recorded in
  `docs/architecture.md`; CI builds the scaffold.
- **Exit:**
  1. App launches from the documented dev command; window opens (AC-F1-1).
  2. bingo binary detection works; missing-binary shows flow-level error (AC-F1-2).
  3. Window shell renders (nav + chat placeholder); resize smoke passes (AC-F1-3, AC-F1-4).
  4. QA smoke checklist for F1 green.

### M1 — Chat loop end-to-end
- **Entry:** M0 exits.
- **Exit:**
  1. All F2 ACs pass against the **real bingo CLI** (no mocks for the core path).
  2. Multi-turn continuity verified (AC-F3-1, AC-F3-2).
  3. Streaming, tool visibility, cancel, and Markdown each demonstrated with recorded evidence
     (QA transcript + screenshots).
  4. Tool-visibility integration decision (§6 Q1) resolved: either implemented, or explicitly
     escalated to the user before M1 is declared done — **never silently dropped**.

### M2 — Sessions & settings
- **Entry:** M1 exits.
- **Exit:**
  1. Session list/resume/rename/delete pass (AC-F3-3 … AC-F3-6).
  2. Provider/model/thinking switcher passes (AC-F4-1 … AC-F4-5).
  3. Settings screen passes (AC-F5-1 … AC-F5-5), including the round-trip test and the
     checksum-preserved-on-failure test.
  4. F1/F2 regression green (the chat loop must not regress while adding sessions/settings).

### M3 — Polish: states, errors, visual QA
- **Entry:** M2 exits.
- **Exit:**
  1. All F6 ACs pass; the GUI is cross-checked against the feedback-states spec (C8) and any
     deviation is recorded with a reason.
  2. Visual QA review (vision agent, dark + light, all four states) passes with no open
     criticals.
  3. Full acceptance checklist (every AC in §3) green → **v0.1 complete**.

## 5. Non-goals (v0.1 — explicitly out)

- **No tray / menu-bar app.** Windowed app only.
- **No auto-update.**
- **No plugin/skill management UI.** Skills run inside bingo; the GUI does not list or configure
  them.
- **No MCP server management UI** (bingo already manages MCP via settings; read-only display of
  `mcpServers` is allowed, editing is not).
- **No team / sub-agent / channel rooms UI.**
- **No file or image attachments in chat** (bingo's `#[image N]` mounting is deferred).
- **No share/export HTML** (bingo `share` already exists; keep the CLI as the entry point).
- **No voice / audio / remote / mobile.**
- **No onboarding wizard**, no analytics/telemetry.
- **No settings beyond the F4/F5 scope** (e.g. no hooks/team/mcp editing, no permission-rule
  editor).
- **No change to the bingo CLI** without explicit user approval (§6 Q1).

## 6. Open integration decisions (architect's call; product requirement anchors in bold)

- **Q1 — Tool-event transport (P0, blocks M1).** The current headless contract exposes text
  streaming but **no tool events** (C2). Product requirement: tool activity must be visible
  (AC-F2-3). Options: (a) propose a small upstream CLI extension (e.g. a `--json` events mode) —
  requires user approval since bingo is read-only; (b) drive the TUI-mode protocol — far more
  complex; (c) accept reduced tool visibility in v0.1 — **not acceptable to the product** unless
  the user explicitly downgrades the requirement.
- **Q2 — Session addressing.** CLI `--continue` resumes only the most recent session (C5); the
  GUI needs per-session resume. Decide how a conversation maps to a bingo session (e.g. resume by
  transcript stem/keyword, or one long-lived process per conversation).
- **Q3 — Ask/permission prompts.** bingo asks questions via stderr/stdin in headless (C7). The
  GUI must surface these as dialogs; decide the transport and the timeouts around a prompt.
- **Q4 — Turn invocation model.** One `bingo --print` process per turn vs. a persistent process;
  affects streaming, cancel semantics (AC-F2-5), and crash recovery (AC-F6-5).
- **Q5 — Settings write path.** Direct JSON edit (preserving unknown keys, atomic, backup) vs.
  shelling out to bingo's own settings writes. Either must satisfy F4/F5 ACs.
- **Q6 — Electron packaging.** Dev launch vs. packaged app for M0 acceptance; electron-builder or
  equivalent is fine, but "the app launches" must mean the same thing for QA in dev and CI.

## 7. Definition of done & success metrics (v0.1)

**Done =** all ACs in §3 pass against the real bingo CLI, with QA's checklist as the single
record, and no open criticals.

**Success metrics (measured by QA during acceptance):**
- **Reliability:** zero crashes across the acceptance run; every sent prompt produces exactly one
  assistant turn or an explicit error (no silent loss).
- **Latency:** first token ≤ 5s after send on a healthy connection (AC-F2-1).
- **Settings integrity:** zero corrupt settings files across ≥20 consecutive save cycles
  (AC-F5-2 / AC-F5-3).
- **Clean exit:** zero orphaned bingo processes after 10 quit cycles (AC-F1-4).

## 8. Sources of truth (bingo reference)

- Headless hooks / streaming: `src/query.rs` (`headless_hooks`, `StreamEvent`)
- Error contract & exit codes: `src/main.rs:530-540`; `notes/research.md` (D30-D32 era)
- Settings schema: `src/settings.rs`
- Transcript/session storage: `src/transcript.rs`
- Slash command surface: `src/tui/slash.rs`
- Feedback conventions: `notes/design/feedback-states.md` (v1.18)
- Error-code contract details: `src/error.rs` (if QA needs `code=` semantics)
