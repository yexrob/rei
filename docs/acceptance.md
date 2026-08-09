# bingo-gui v0.1 Acceptance Plan

> Status: framework ready; execution not started
> Owner: QA (`gui-qa`)
> Product source: `docs/prd.md`
> CLI contract source: `/Users/yexrob/Episodes/Projects/bingo` (read-only)
>
> All items are intentionally unchecked. This document defines future acceptance; no application
> tests were run while creating it.

## 1. Gate rules and evidence

A checkbox may be marked complete only when the recorded action, observation, and pass condition
all agree. A build passing unit tests is not a substitute for the black-box behavior below.

For every run, record:

- bingo-gui commit and build mode, bingo binary absolute path and `bingo --version`, OS, and run ID;
- the documented launch command, app/child exit codes, timestamps, and relevant process IDs;
- sanitized stdout/stderr and renderer/main-process logs (never retain API keys);
- screenshots named by run, AC, theme, state, and viewport;
- fixture/config/transcript paths plus before/after hashes where storage integrity is asserted;
- the expected result, actual result, and a defect link for every failure.

Use an isolated QA `HOME`/`XDG_CONFIG_HOME`, transcript directory, harmless working directory, and
credentials intended for testing. Never mutate the user's normal bingo settings or transcripts.
The executable under test must be the real bingo binary. A deterministic local provider may be
used to control SSE timing, tool calls, and HTTP failures, but it must be reached through bingo's
normal provider/API path; replacing or bypassing bingo does not satisfy an end-to-end item.
Network-dependent checks must first record that the selected provider is healthy.

### Status and severity

- `[ ]` means not run, `[x]` means passed. A failed or blocked item remains unchecked with a defect
  or blocker beside it.
- **Critical:** crash, data/secret loss, settings corruption, silent prompt loss/duplication,
  invisible tool execution, or an unusable launch/chat path.
- **High:** an AC fails without a safe workaround. **Medium/Low:** degraded but recoverable behavior.
- A milestone is **PASS** only when its entry criteria are met, every listed exit assertion passes,
  required evidence exists, and it has no open Critical or High defect. Otherwise it is **FAIL** or
  **BLOCKED**; criteria are never waived silently.

### Contract oracles

- Structured CLI failure oracle: stderr contains exactly one terminal error record of the form
  `[error] code=<SCREAMING_SNAKE> msg=<single line of at most 200 characters>` and the process exits
  `1`. The GUI must preserve the parsed `code` and full `msg`; it must not replace them with generic
  copy. Other diagnostic stderr lines may precede the terminal record.
- Success oracle: bingo exits `0`; streamed stdout concatenates to the final assistant text.
- Tool-visibility oracle: every unique tool-call ID in the architecture-approved event transport
  has exactly one visible activity row and a terminal `done` or `error` state.
- Storage oracle: SHA-256 hashes plus a recursive file manifest before and after the action.
- Process oracle: capture the launched app PID and descendant bingo PIDs; inspect that PID tree,
  rather than using an unscoped process-name search that may match another session.

## 2. Feature QA loop

Apply this loop to each feature and repeat it after every corrective change:

1. **Developer implements.** `gui-dev` supplies the implementation commit, focused automated-test
   result, reproduction command, and the states/edge paths changed.
2. **Screenshot is captured.** Capture the affected state at the agreed default viewport and at
   800×600; capture both themes when appearance is theme-dependent. Error/loading work includes
   the corresponding state, not only the happy path.
3. **Vision review runs.** `gui-vision` inspects the real screenshots for hierarchy, clipping,
   contrast, state clarity, and regressions. Findings carry severity and screenshot coordinates.
4. **QA verifies behavior.** `gui-qa` executes the matching assertions in this document against the
   implementation commit, records black-box evidence, and opens defects for mismatches. A screenshot
   cannot prove interaction, process cleanup, persistence, or error-contract fidelity.
5. **Milestone is gated.** QA publishes `PASS`, `FAIL`, or `BLOCKED` with checked ACs, evidence links,
   open defects, and approved deviations. Any fix returns to step 1; a milestone advances only on
   `PASS`.

## 3. M0 — Scaffold: the app launches

**Entry gate**

- [ ] **M0-ENTRY-1 — Architecture and build.** Checkout the candidate commit and inspect
  `docs/architecture.md` plus CI. **Observe:** the process/integration/packaging decisions are
  recorded and CI builds the scaffold. **Pass:** architecture exists at the tested commit and its
  scaffold build is green.

**Exit checklist**

- [ ] **AC-F1-1 — Launch, window, and versions.** Run the documented dev command from a clean
  checkout while timing from process start; independently capture the app version and
  `bingo --version`. **Observe:** one usable Electron window appears within 10s and a visible status
  area shows both versions. **Pass:** launch command remains alive without an uncaught error, the
  window is visible/interactive by 10.000s, and both displayed values exactly match their sources.
- [ ] **AC-F1-2 — Missing bingo binary.** Start with `PATH` excluding bingo, then separately with
  an invalid configured binary path containing a unique test suffix. **Observe:** chat is not
  opened; a flow-level error shows the exact attempted path and Retry. Restore a valid real binary
  and select Retry. **Pass:** neither case crashes, the invalid path is reproduced verbatim, Retry
  is keyboard/click reachable, and recovery reaches the shell without restarting the app.
- [ ] **AC-F1-3 — 800×600 resize.** Resize the content area to 800×600 and inspect nav, status,
  chat placeholder, controls, and scroll containers using a screenshot plus element bounds.
  **Observe:** controls remain reachable; overflow is confined to intended scroll regions.
  **Pass:** no controls overlap, no text/content is clipped, no page-level horizontal scrollbar is
  introduced, and all element bounds remain inside the viewport or an intentional scroll region.
- [ ] **AC-F1-4 — Clean quit and child cleanup.** In each of 10 cycles, launch the app, start a
  bingo child, capture the PID tree, then close the window normally. **Observe:** app command exit
  status and descendant PIDs at 3s. **Pass:** every cycle exits cleanly (status `0`) and every
  spawned bingo descendant is gone within 3.000s; zero orphaned children remain.
- [ ] **M0-SHELL-1 — Required shell.** Launch normally at the candidate commit. **Observe:** nav and
  chat placeholder are both rendered, and the shell has no blank/broken panel. **Pass:** both are
  visible and usable, with screenshot evidence at default size and 800×600.

**M0 verdict:** `[ ] PASS  [ ] FAIL  [ ] BLOCKED`
Evidence/defects: _not run_

## 4. M1 — Chat loop end-to-end

**Entry gate**

- [ ] **M1-ENTRY-1 — M0 passed.** Open the latest M0 report. **Observe:** its commit ancestry and
  verdict. **Pass:** M0 is `PASS` and the M1 candidate contains that accepted commit.
- [ ] **M1-ENTRY-2 — Tool transport resolved.** Compare `docs/architecture.md` with PRD Q1 and the
  implementation. **Observe:** the user-approved `--json-events` transport has a versioned event
  contract and exposes text plus every tool lifecycle event; any later scope reduction has separate
  explicit user approval. **Pass:** AC-F2-3 is implementable through the approved upstream worktree
  binary and is not silently reduced; a missing schema/implementation or unapproved CLI change
  blocks M1.

**Exit checklist**

- [ ] **AC-F2-1 — Prompt appears and first token is timely.** On a preflighted healthy provider,
  send a unique prompt and timestamp submit, user-row insertion, and first non-whitespace assistant
  delta. Repeat three times. **Observe:** the user row appears synchronously and one assistant turn
  begins. **Pass:** each submit creates exactly one immediate user row and each first token arrives
  within 5.000s.
- [ ] **AC-F2-2 — Progressive and faithful stream.** From identical isolated session snapshots,
  run a deterministic multi-delta answer once through the GUI and once through
  `bingo --print "<same prompt>"`. Record each GUI DOM update and raw CLI stdout. **Observe:** at
  least two non-empty assistant updates occur before completion. **Pass:** ordered deltas only append
  to the active reply, and final visible text equals concatenated CLI stdout after newline
  normalization only (no missing, duplicated, or reordered text).
- [ ] **AC-F2-3 — Every tool call is visible.** Use the real bingo binary with a controlled turn
  that performs one successful and one failing harmless tool call. Correlate canonical transport
  tool-call IDs to UI rows. **Observe:** tool name, short input summary, and timestamped
  `running → done|error` transitions. **Pass:** visible IDs equal transport IDs exactly, every row
  reaches the correct terminal state, and no input secrets/full sensitive payloads are exposed.
- [ ] **AC-F2-4 — Duplicate prevention.** During a deliberately long turn, press Enter repeatedly,
  click Send repeatedly, then mix both; inspect UI messages, transport requests, and bingo children.
  **Observe:** send controls communicate disabled/busy state. **Pass:** only the original prompt is
  submitted, no queued/hidden second turn starts when the first ends, and there is exactly one user
  row and one request for the action.
- [ ] **AC-F2-5 — Cancel and late-result suppression.** Start a controlled long stream/tool call,
  cancel after a delta, then make the old transport emit a late delta while immediately preparing a
  new prompt. **Observe:** interrupted marker, process/event termination, idle transition, and next
  input readiness. **Pass:** cancelled is visible, idle/input usability returns within 1.000s, no
  late old delta changes state, and the next prompt can complete normally.
- [ ] **AC-F2-6 — Markdown and injection safety.** Return a fixture containing a heading, list,
  bold, inline code, fenced code, raw HTML, a `<script>` sentinel, event-handler HTML, and a
  `javascript:` link. **Observe:** semantic rendered elements and renderer side-effect sentinel.
  **Pass:** required Markdown forms render correctly, dangerous content is escaped/removed, no
  script/event/link executes, and model HTML cannot invoke Electron/Node capabilities.
- [ ] **AC-F2-7 — Structured non-zero error.** Cause a real bingo exit `1` with a known terminal
  `[error]` line; capture raw stderr and UI. Include messages containing spaces and HTML metacharacters.
  **Observe:** inline turn error and still-enabled composer. **Pass:** UI `code` and `msg` exactly
  equal the raw terminal record, copy remains safely escaped, no partial assistant turn is reported
  as success, and the next prompt can be sent without restart.
- [ ] **AC-F3-1 — Context continuity.** In one conversation send “Remember the exact nonce
  `<unique value>`” and then “Return only the nonce I asked you to remember.” Also inspect the
  second request/session identity. **Observe:** second turn uses the same conversation context.
  **Pass:** the exact nonce is returned without being included in prompt two, and transport evidence
  confirms continuity rather than GUI-side prompt repetition.
- [ ] **AC-F3-2 — Fresh conversation isolation.** After AC-F3-1, create a new conversation and ask
  for the old nonce; inspect the request context/session identity. **Observe:** a new empty thread and
  no prior nonce in the request context. **Pass:** previous messages/nonce are absent from the new
  request and UI history; no prior fact is carried into the fresh session.
- [ ] **M1-EVIDENCE-1 — Demonstration bundle.** Review the run artifacts. **Observe:** timestamped
  transcript/event log and screenshots for streaming, successful/failing tool activity, cancel,
  Markdown, and structured error. **Pass:** each artifact maps to the same tested commit and the
  corresponding AC above.

**Required error-path matrix at M1**

- [ ] **M1-ERR-API — API failures remain structured.** Through the real bingo process, make the
  provider return 401, 403, 429, and 5xx, plus an unreachable endpoint. **Observe:** raw terminal
  lines and UI errors. **Pass:** each exit is `1`; UI preserves bingo's emitted code (normally
  `AUTH_REQUIRED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `SERVER_ERROR`, and `OFFLINE`) and exact
  sanitized `msg`, gives a useful next action, and remains usable. The emitted line—not this list—is
  the final oracle if upstream adds a code.

**M1 verdict:** `[ ] PASS  [ ] FAIL  [ ] BLOCKED`
Evidence/defects: _not run_

## 5. M2 — Sessions and settings

**Entry gate**

- [ ] **M2-ENTRY-1 — M1 passed.** Open the latest M1 report. **Observe:** its commit ancestry and
  verdict. **Pass:** M1 is `PASS` and the M2 candidate contains that accepted commit.

### Sessions

- [ ] **AC-F3-3 — Complete, newest-first session list.** Seed bingo-owned transcript fixtures with
  distinct names, previews, and timestamps, including equal-day and long-text cases, then open the
  list. **Observe:** row count/content/order. **Pass:** every and only seeded session appears once
  with correct name, last-message preview, timestamp, and strict newest-first ordering.
- [ ] **AC-F3-4 — Resume full history and context.** Seed a multi-message transcript containing a
  unique nonce, resume it from a non-latest list row, scroll from first to last message, then ask for
  the nonce. **Observe:** restored order/content and invocation target. **Pass:** full history is
  rendered once in order and the next real bingo turn resumes the selected—not merely latest—session
  and returns the nonce.
- [ ] **AC-F3-5 — Rename and confirmed delete.** Rename a seeded session, restart the GUI, then
  initiate delete and first cancel, then confirm. **Observe:** persistence, confirmation dialog,
  transcript state, and list. **Pass:** rename survives restart; cancellation changes nothing;
  confirmation removes the row and transcript; all mutation is delegated through the
  architecture-approved bingo-owned path rather than an unapproved renderer write.
- [ ] **AC-F3-6 — GUI is not a transcript writer.** Hash/manifest the transcript directory, browse
  and resume without sending, then compare; separately send one turn and trace file writers.
  **Observe:** idle-read diff and writer attribution for expected turn changes. **Pass:** browsing
  and rendering are byte-identical; during a turn only bingo-owned expected transcript files change,
  with no GUI-authored JSONL content. The intentional bingo-owned rename/delete behavior in
  AC-F3-5 must be documented by the architecture.

### Provider/model configuration

- [ ] **AC-F4-1 — Exact switcher contents.** Seed settings with two distinct providers, active
  provider/model/thinking level, and unrelated keys; open the switcher. **Observe:** provider set,
  active marker, model, and thinking level. **Pass:** provider names equal `{default} ∪ settings
  provider keys` exactly, no duplicates/phantoms exist, and all active values match effective bingo
  settings.
- [ ] **AC-F4-2 — Persistence and plain-CLI round trip.** Change provider, model, and thinking level,
  close the app, parse settings JSON, then run plain `bingo --print "hi"` against a request-capture
  provider. **Observe:** valid file and captured provider/model/thinking request. **Pass:** all three
  selections persist in the user layer and the independent CLI invocation uses them; unrelated and
  unknown keys are unchanged.
- [ ] **AC-F4-3 — Bad model rejected safely.** Enter `qa-definitely-invalid-model`, record the
  settings checksum, and attempt save/use. **Observe:** field-level error and file/request state.
  **Pass:** error specifically explains why the value is invalid and what to do, the bad value is
  not written or sent, checksum remains unchanged, and valid prior settings still work. If bingo
  supplies a structured error, its `code` and `msg` are also preserved verbatim.
- [ ] **AC-F4-4 — API-key secrecy.** Seed a unique sentinel API key; visit every settings/switcher
  view, save, trigger success and failure, and capture screenshots, accessibility text, app logs,
  child command lines, and renderer console. **Observe:** visual masking and sentinel search.
  **Pass:** key is never displayed in plain text and sentinel is absent from logs, console, error
  copy, screenshots, telemetry, and process arguments; it appears only in the intended settings
  file/provider request secret channel.
- [ ] **AC-F4-5 — Next-turn activation.** Complete turn A, switch provider/model, then send turn B
  without restart while capturing both requests. **Observe:** selected active marker and request
  routing. **Pass:** A uses old values, B uses new values, no extra stale-provider request occurs,
  and the app remains usable.

### Settings screen

- [ ] **AC-F5-1 — Effective values displayed.** Seed user/project/local layers with intentional
  overrides and open Settings. **Observe:** endpoints, active provider, model, thinking, permission
  mode, theme, and image support. **Pass:** every displayed value equals bingo's effective precedence
  result, with secret values masked.
- [ ] **AC-F5-2 — Atomic valid save and failure preservation.** Seed nested unknown keys and hash
  the file; perform 20 valid edits/saves while concurrently parsing observed file versions, then
  force validation and write/rename failures. **Observe:** parse results, unknown-key deep equality,
  temporary files, and hashes. **Pass:** every successful version is complete valid JSON, all unknown
  keys survive unchanged, no reader sees partial content, and every failed save leaves the old file
  byte-identical with a useful error.
- [ ] **AC-F5-3 — Pre-edit backup.** Before a valid change, capture original bytes and save once.
  **Observe:** timestamped backup and resulting file. **Pass:** a backup is created before replacement,
  its bytes exactly equal the pre-edit file, and naming matches the documented bingo-compatible
  convention without overwriting an older backup.
- [ ] **AC-F5-4 — Corrupt or unreadable settings.** In separate runs provide malformed JSON and a
  file that the app cannot read; hash each before launch. **Observe:** launch behavior, flow-level
  parse/I/O message, recovery action, and post-run file. **Pass:** app does not crash or expose broken
  chat, the exact path and actionable recovery are shown, and the source file remains byte-identical.
- [ ] **AC-F5-5 — Saved toast behavior.** Save successfully, time the toast, hover across its normal
  expiry, and trigger three rapid saves. **Observe:** text, live-region announcement, timestamps,
  and stack count. **Pass:** “Saved” appears for each success, unhovered lifetime is 3s within test
  clock precision, hover pauses then resumes dismissal, and no more than two toasts are visible.

### M2 regression gate

- [ ] **M2-REG-F1/F2 — Launch and chat regression.** Re-run every M0 F1 and M1 F2 assertion at the
  M2 candidate. **Observe:** current-run evidence, not inherited checkmarks. **Pass:** AC-F1-1…4 and
  AC-F2-1…7 all pass with no new Critical/High defect.

**M2 verdict:** `[ ] PASS  [ ] FAIL  [ ] BLOCKED`
Evidence/defects: _not run_

## 6. M3 — States, errors, accessibility, and visual QA

**Entry gate**

- [ ] **M3-ENTRY-1 — M2 passed.** Open the latest M2 report. **Observe:** its commit ancestry and
  verdict. **Pass:** M2 is `PASS` and the M3 candidate contains that accepted commit.

**Exit checklist**

- [ ] **AC-F6-1 — Delayed, scoped loading.** Run controlled 150ms and 500ms page/button operations
  with timestamps. **Observe:** indicator visibility and scope. **Pass:** no indicator is visible at
  or below 200ms; for the long operation it appears only after 200ms and clears on settle; page work
  uses a skeleton/spinner, button work replaces button content, and no fullscreen blocking overlay
  appears.
- [ ] **AC-F6-2 — Actionable error copy.** Trigger every acceptance error fixture (missing binary,
  bad model, API errors, corrupt settings, save failure, child crash) and audit visible copy.
  **Observe:** statement of failure and recovery control/instruction. **Pass:** every error says what
  happened and a concrete next action; no dead-end “operation failed” copy remains.
- [ ] **AC-F6-3 — Retry/cancel stale-race protection.** Make request A resolve late after cancel,
  then after Retry start request B and resolve B before A. **Observe:** state/event sequence and
  screenshot/video. **Pass:** no A content/state flashes after invalidation, B remains authoritative,
  and terminal/loading state corresponds only to the latest sequence.
- [ ] **AC-F6-4 — Empty states.** Launch with no transcripts, then create a new empty conversation.
  **Observe:** no-sessions and empty-thread views. **Pass:** first shows a welcome screen with one
  primary “Start a new conversation” action; second shows a prompt hint; neither contains a blank,
  broken, or misleading panel.
- [ ] **AC-F6-5 — Child crash and recovery.** Start a controlled long turn, capture its bingo PID,
  kill that child externally, timestamp process death to visible error, then select Retry.
  **Observe:** page-level error, process cleanup, idle state, and retry turn. **Pass:** actionable
  error appears within 2.000s, app stays alive, returns to idle without restart, no orphan remains,
  and Retry can complete through a new child.
- [ ] **AC-F6-6 — Keyboard and accessible announcements.** Focus the composer; verify Enter once,
  Shift+Enter, then trigger an error and toast while inspecting DOM/accessibility state.
  **Observe:** submitted requests, textarea value, `aria-live`, and `document.activeElement` after
  render. **Pass:** Enter submits exactly once, Shift+Enter inserts a newline without submit, errors
  and toasts are announced by live regions, and the rendered error receives focus asynchronously.
- [ ] **AC-F6-7 — Dark/light visual matrix.** Capture real chat, empty, >200ms loading, and error
  states in both `dark` and `light` at default size and 800×600; submit all 16 minimum screenshots
  to `gui-vision`. **Observe:** vision findings plus measured foreground/background contrast.
  **Pass:** correct theme follows bingo settings, no clipping/overlap or ambiguous state exists,
  normal text reaches 4.5:1 (large text 3:1; essential non-text UI 3:1), and vision reports no open
  Critical/High issue.

### Required state and failure matrix

- [ ] **M3-STATE-MATRIX — Loading, empty, and error states are present.** Traverse idle chat,
  no-sessions, empty conversation, delayed page loading, delayed button loading, field error, page
  error, and flow error. **Observe:** distinct screenshots and reachable recovery path for each.
  **Pass:** every state exists, is visually distinguishable, has correct scope, and returns to a
  usable state where recovery is possible.
- [ ] **M3-FEEDBACK-SPEC — bingo convention cross-check.** Compare observed timings, timeouts,
  toast behavior, error levels, copy, and stale-response handling to
  `/Users/yexrob/Episodes/Projects/bingo/notes/design/feedback-states.md`. **Observe:** a row-by-row
  conformance report. **Pass:** loading threshold is >200ms; short reads/writes use 10s/15s where
  applicable; long agent turns have no short-operation timeout; toasts/errors/races conform; every
  deviation has explicit product/architecture approval and rationale.

### Full-release gate

- [ ] **M3-ALL-ACS — Full acceptance rerun.** Execute every AC-F1-1 through AC-F6-7 against one
  release-candidate commit. **Observe:** one complete evidence index and defect report. **Pass:** all
  34 PRD ACs are checked on that commit and no Critical/High defect is open.
- [ ] **M3-RELIABILITY — v0.1 success metrics.** Review the full run, the 10 quit cycles, 20 save
  cycles, and every prompt/event pair. **Observe:** crash count, orphan count, corrupt-file count,
  prompt-to-outcome cardinality, and latency samples. **Pass:** zero crashes, zero orphans, zero
  corrupt settings files, every sent prompt yields exactly one assistant turn or explicit error,
  and healthy first-token samples are all ≤5s.

**M3 verdict:** `[ ] PASS  [ ] FAIL  [ ] BLOCKED`
Evidence/defects: _not run_

## 7. Known pre-execution blockers and reconciliation points

These do not change the PRD; they identify what must be resolved before the relevant gate can pass.

1. **Tool events:** PRD Q1 is user-approved: implement opt-in `--json-events` in a separate bingo
   worktree and point the GUI at that worktree-built real binary. M1 remains blocked until the
   architecture records the schema and the implementation proves complete tool-event coverage.
2. **Selected-session resume:** `--continue` addresses only the latest transcript. M2 requires an
   architecture-backed, bingo-owned way to resume a selected session.
3. **Transcript ownership:** AC-F3-5 requires rename/delete while AC-F3-6 forbids GUI transcript
   writes. Acceptance interprets this as GUI orchestration of a bingo-owned mutation path; direct
   renderer/main-process transcript mutation requires explicit PRD reconciliation.
4. **Output equivalence:** model output is not generally deterministic. AC-F2-2 therefore uses
   isolated identical session snapshots and a deterministic provider while retaining the real bingo
   executable and transport path.
5. **Ask/permission prompts:** PRD Q3 remains an architecture decision. Any M1 fixture that asks for
   approval must prove the GUI can answer through the chosen transport rather than hanging stdin.

## 8. Milestone report template

```text
Milestone / run ID:
Candidate commit:
Bingo path + version:
Environment:
Verdict: PASS | FAIL | BLOCKED
Passed assertions:
Failed/blocked assertions + defects:
Vision report + screenshot index:
Automated checks:
Black-box evidence:
Approved deviations:
Residual risks:
QA owner + timestamp:
```
