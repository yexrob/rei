# bingo-gui v0.1 architecture

> Status: accepted design for implementation  
> Owner: architecture (`gui-arch`)  
> Product contract: [`docs/prd.md`](./prd.md)  
> CLI facts: [`docs/cli-facts.md`](./cli-facts.md)
> Upstream reference: `/Users/yexrob/Episodes/Projects/bingo` (read-only main checkout)

## 1. Decision summary

| Decision | Choice | Why |
|---|---|---|
| Q1: agent transport | Add an opt-in, versioned NDJSON stdio mode: `bingo --json-events` | The existing `--print` surface streams text but discards tool, prompt, and lifecycle events. Scraping the TUI or stderr would not be a stable contract. |
| Q2: session addressing | One GUI conversation maps exactly to one bingo transcript stem; JSON mode accepts `--session <exact-stem>` and omission creates a new session | Existing `--continue` selects a global latest file and races when conversations coexist. Exact opaque IDs are deterministic and reject substring ambiguity. |
| Q3: asks and permissions | Bidirectional NDJSON: bingo emits `prompt.request`; the GUI replies with `prompt.respond` by `promptId` | Existing human-formatted stderr/stdin prompts are unframed and cannot be distinguished safely from diagnostics. Prompts have no short timeout. |
| Q4: process lifetime | One persistent child belongs to the active conversation; it handles many turns and is never rebound to another transcript | This preserves in-memory history, makes cancel/prompt flow explicit, avoids process startup on every turn, and retains process isolation. Switching conversations closes the old child and starts a child for the selected exact transcript. |
| Q5: settings writes | Electron main edits only the user settings layer with optimistic concurrency, backup, validation, and atomic replacement | bingo has no non-interactive settings command. Main is the trusted filesystem owner; renderer and preload never receive filesystem access or stored secrets. |
| Q6: build/package | TypeScript + React, `electron-vite`, and `electron-builder`; M0 requires both dev launch and an unpacked packaged-app smoke test | This is a conventional, well-supported Electron toolchain without manual multi-process bundler wiring. The package carries a protocol-compatible bingo binary. |
| Renderer state | React Context + `useReducer`; no Redux/Zustand in v0.1 | One window and one active conversation do not justify another state dependency. A pure reducer is sufficient for event-order and stale-response tests. |
| Runtime validation | Zod schemas at every independently consumed seam | TypeScript types disappear at runtime. IPC payloads, settings data, transcript JSONL, and child NDJSON are untrusted inputs. |

These are implementation decisions, not options. A later change must update this document and the affected contract tests first.

## 2. Verified CLI reality and its consequence

The current bingo main checkout has no server mode, GUI API, or JSON output flag.

- `bingo --print "prompt"` executes one query and exits (`bingo/src/main.rs`).
- If the prompt argument is omitted, non-TTY stdin is read to EOF as the entire prompt. A TTY without a prompt fails fast.
- `headless_hooks` writes each `TextDelta` directly to stdout and flushes it (`bingo/src/query.rs`). It intentionally ignores thinking, tool-ready, tool-done, and round events.
- The query loop writes a plain trailing newline to stdout at turn completion. stdout is therefore a text stream, not framed records.
- Headless permission and `AskUserQuestion` flows print human copy to stderr and then read unframed answers from stdin.
- Non-TTY fatal errors use stderr `[error] code=<SCREAMING_SNAKE> msg=<single line up to 200 chars>` and exit 1.
- `--continue` restores only the most recently modified transcript globally.
- Transcripts are JSONL under `~/.local/share/bingo/transcripts`, and bingo is their writer.

Therefore the current public CLI cannot satisfy all of F2 and F3 safely. In particular, a GUI cannot correlate same-named concurrent tool calls, distinguish stderr diagnostics from questions, or resume a chosen conversation through `--continue`.

The integration seam will be a small upstream **front-end adapter** over bingo's existing renderer-agnostic `UiHooks`/`UiEvent` architecture. It does not create a second agent engine. The existing TUI and `--print` adapters remain unchanged.

All bingo-side work must happen in a dedicated worktree such as:

```text
/Users/yexrob/Episodes/Projects/bingo/.bingo/worktrees/feat/gui-json-events
```

The main checkout at `/Users/yexrob/Episodes/Projects/bingo` remains read-only. During development, `BINGO_GUI_BINARY` points to the worktree-built binary.

## 3. System shape and module seams

```text
┌──────────────────────────────── Renderer (untrusted) ────────────────────────────────┐
│ React views → reducer → window.bingoGui (narrow typed facade)                        │
└──────────────────────────────────────┬────────────────────────────────────────────────┘
                                       │ validated IPC
┌──────────────────────────────── Preload (sandboxed) ─────────────────────────────────┐
│ contextBridge adapter; no raw ipcRenderer, Node, filesystem, shell, or child_process │
└──────────────────────────────────────┬────────────────────────────────────────────────┘
                                       │ allowlisted channels only
┌──────────────────────────────── Electron main (trusted) ─────────────────────────────┐
│ IPC router                                                                          │
│ ├─ RuntimeLocator        binary resolution/version/protocol probe                    │
│ ├─ SessionManager        exactly one active BingoSession                            │
│ │   └─ StdioBingoSession child lifecycle, NDJSON parser, command writer              │
│ ├─ TranscriptRepository  read/list/project transcript JSONL only                    │
│ ├─ SettingsRepository    read/validate/backup/atomic user-layer writes               │
│ └─ VisualCapture         debug-gated webContents.capturePage                         │
└──────────────────────────────────────┬────────────────────────────────────────────────┘
                                       │ versioned NDJSON over stdio
┌──────────────────────────────── bingo child (trusted local executable) ──────────────┐
│ JSON front-end adapter → existing Session/run_query/tools/transcript/settings core   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The important deep modules are:

1. **`BingoSession`** hides child-process spawning, framing, cancellation, event ordering, and exit handling behind `open`, `sendTurn`, `cancelTurn`, `respondToPrompt`, and `close`.
2. **`SettingsRepository`** hides layer resolution, revision checks, secret handling, backup, validation, and atomic replacement behind `read` and `save`.
3. **`TranscriptRepository`** hides path validation, JSONL recovery, pairing tool results, and preview generation behind `list` and `load`.

Tests use in-memory/fake adapters at these same seams; production uses the filesystem/child adapters. There is no generic plugin system in v0.1.

## 4. bingo NDJSON stdio contract (protocol version 1)

This section is the **single normative source** for protocol v1 names, fields, ordering, and error behavior. The proposal recorded in `docs/cli-facts.md` §10 predates this decision and is non-normative historical analysis; where it differs, this section wins. Shared Rust/TypeScript fixtures must be generated or copied from this schema, never from the earlier proposal.

### 4.1 Invocation

```bash
bingo --json-events [--session <EXACT_TRANSCRIPT_STEM>]
```

Existing compatible options such as `--model`, `--permission-mode`, and `--no-team` may accompany JSON mode. In protocol v1:

- `--json-events` conflicts with `--print`, `--inline`, `--fullscreen`, subcommands, and positional prompts.
- Omitting `--session` atomically reserves a fresh transcript ID for the process working directory before `session.ready`. The upstream allocator must use an exclusive create (`create_new`/`O_EXCL`) and a random UUID suffix, e.g. `<project-slug>-<unix-seconds>-<uuid>`, retrying only on collision. The existing seconds-only allocator is not used in JSON mode.
- `--session` accepts a transcript **stem**, never a path, and matches it exactly. `/`, `\`, `..`, empty IDs, substring matches, and multiple matches are rejected.
- stdin is exclusively UTF-8 NDJSON commands.
- stdout is exclusively UTF-8 NDJSON events. Every event is one JSON object followed by `\n`, flushed immediately.
- stderr is diagnostics for humans/support logs only. It is not part of the machine protocol and is never parsed for prompts or normal errors.
- The first stdout record is `session.ready`, or a fatal `error` followed by process exit 1.
- Malformed JSON, an unsupported command, a line over 1 MiB, or a protocol-version mismatch emits a fatal `error` with `code="BAD_ARGUMENT"` and exits 2.
- Event lines are capped at 8 MiB. Tool output is clipped before serialization, using bingo's existing output budget.
- One process handles one transcript for its lifetime. A rename changes that process's session ID; no command can switch it to a different transcript.

The GUI starts the process with ordinary pipes, not a PTY. It passes an explicit absolute `cwd`, inherits the user's environment with only documented overrides, and never invokes a shell.

### 4.2 Common wire rules

Client-generated identifiers are UUID strings. All event `seq` values are process-local unsigned integers beginning at 1 and increasing by exactly 1. Every command has `protocolVersion: 1` and a unique `commandId`.

```ts
type ProtocolVersion = 1

type ClientCommand =
  | {
      protocolVersion: 1
      type: 'turn.start'
      commandId: string
      turnId: string
      prompt: string
    }
  | {
      protocolVersion: 1
      type: 'turn.cancel'
      commandId: string
      turnId: string
    }
  | {
      protocolVersion: 1
      type: 'prompt.respond'
      commandId: string
      turnId: string
      promptId: string
      response:
        | { kind: 'option'; optionId: string }
        | { kind: 'text'; text: string }
        | { kind: 'cancel' }
    }
  | {
      protocolVersion: 1
      type: 'providers.list'
      commandId: string
    }
  | {
      protocolVersion: 1
      type: 'models.list'
      commandId: string
      provider: string
    }
  | {
      protocolVersion: 1
      type: 'session.rename'
      commandId: string
      name: string
    }
  | {
      protocolVersion: 1
      type: 'session.delete'
      commandId: string
    }
  | {
      protocolVersion: 1
      type: 'session.close'
      commandId: string
    }

type EventBase = {
  protocolVersion: 1
  seq: number
  sessionId: string | null
}
```

Prompt and session names are bounded before work begins:

- `prompt`: 1 to 1,000,000 Unicode scalar values after preserving user whitespace; an all-whitespace prompt is rejected.
- prompt free-text answer: at most 100,000 Unicode scalar values.
- rename: trimmed, 1 to 80 Unicode scalar values; bingo remains responsible for filesystem-safe slugging.

### 4.3 Event schema

```ts
type CliEvent =
  | (EventBase & {
      type: 'session.ready'
      metadata: CliSessionMetadata
    })
  | (EventBase & {
      type: 'turn.started'
      commandId: string
      turnId: string
    })
  | (EventBase & {
      type: 'text.delta'
      turnId: string
      delta: string
    })
  | (EventBase & {
      type: 'tool.ready'
      turnId: string
      toolCallId: string
      name: string
      summary: string
    })
  | (EventBase & {
      type: 'tool.done'
      turnId: string
      toolCallId: string
      name: string
      summary: string
      status: 'done' | 'error' | 'interrupted'
      output: string
      durationMs: number
    })
  | (EventBase & {
      type: 'prompt.request'
      turnId: string
      promptId: string
      kind: 'permission' | 'question'
      title: string
      question: string
      options: Array<{
        id: string
        label: string
        description?: string
      }>
      allowFreeText: boolean
    })
  | (EventBase & {
      type: 'prompt.resolved'
      turnId: string
      promptId: string
      commandId?: string
      reason: 'responded' | 'turn-cancelled' | 'session-closing'
    })
  | (EventBase & {
      type: 'providers.result'
      commandId: string
      providers: Array<{
        name: string
        protocol: 'anthropic' | 'openai'
        apiBaseUrl: string
        supportsImages: boolean
        credentialConfigured: boolean
        builtin: boolean
      }>
    })
  | (EventBase & {
      type: 'models.result'
      commandId: string
      provider: string
      models: string[]
    })
  | (EventBase & {
      type: 'warning'
      turnId?: string
      code?: string
      msg: string
    })
  | (EventBase & {
      type: 'turn.completed'
      turnId: string
      outputTokens?: number
    })
  | (EventBase & {
      type: 'turn.cancelled'
      turnId: string
      commandId?: string
      reason: 'requested' | 'stdin-eof' | 'session-closing'
    })
  | (EventBase & {
      type: 'session.renamed'
      commandId: string
      previousSessionId: string
      metadata: CliSessionMetadata
    })
  | (EventBase & {
      type: 'session.deleted'
      commandId: string
      deletedSessionId: string
    })
  | (EventBase & {
      type: 'session.closed'
      commandId: string
    })
  | (EventBase & {
      type: 'error'
      scope: 'command' | 'turn' | 'session'
      commandId?: string
      turnId?: string
      code: string
      msg: string
      level: 'field' | 'page' | 'flow'
      recoverable: boolean
    })

type CliSessionMetadata = {
  bingoVersion: string
  protocolVersion: 1
  sessionId: string
  transcriptPath: string // trusted main-process field; removed from every renderer projection
  resumed: boolean
  cwd: string
  provider: string
  model: string
  thinkingLevel: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  permissionMode: string
  theme: 'auto' | 'dark' | 'light'
  supportsImages: boolean
}
```

The machine `error.msg` uses the same single-line, 200-character sanitization as current non-TTY errors. Existing stable `ErrorCode` values are reused. JSON mode does not print an additional `[error] ...` line to stdout or stderr for a represented error.

Error termination is scoped:

- `error(scope='command', recoverable=true)` rejects only that command; the process/state before the command remains valid.
- `error(scope='turn', recoverable=true)` is the exactly-once terminal event for that turn; the child returns to idle and remains alive. No second `turn.completed`/`turn.cancelled` follows.
- `error(scope='session')` is emitted when framing, startup, persistence, or another invariant makes the session unsafe; bingo flushes it and exits 1. Invocation/clap misuse before JSON framing may exit 2 with ordinary clap stderr.
- The legacy stderr `[error] code=... msg=...` plus exit 1 contract remains unchanged for non-JSON `--print`; it is not the JSON-turn oracle.

### 4.4 Ordering and completion invariants

The upstream adapter and GUI both test these invariants:

1. `session.ready` has `seq=1` and precedes all non-fatal events.
2. At most one `turn.start` is active. A second start returns a recoverable command error and does not enter history.
3. A successful start yields exactly one `turn.started`, then exactly one terminal event: `turn.completed`, `turn.cancelled`, or `error(scope='turn')`.
4. `text.delta` values concatenate byte-for-byte to the assistant text that ordinary `--print` would emit for the same initial state.
5. Every `tool.ready` has a stable `toolCallId`, even when names repeat or tools execute concurrently.
6. Every ready tool receives exactly one `tool.done` before the terminal turn event. A denied or failed tool uses `status='error'`; cancellation uses `status='interrupted'`.
7. `tool.ready.summary` and `tool.done.summary` use bingo's existing input summarizer. The GUI does not reimplement per-tool summarization.
8. Multiple prompt requests may exist, but the renderer presents them FIFO, one modal at a time. Each `prompt.respond` carries the current `turnId`, targets one live ID exactly once, and produces `prompt.resolved(reason='responded', commandId=<response command>)`.
9. Prompts have no elapsed-time timeout. A turn cancellation resolves all outstanding prompts as `prompt.resolved(reason='turn-cancelled', commandId=<cancel command when one exists>)` before `turn.cancelled`; stdin EOF/session close use an absent command ID plus their explicit reason.
10. `turn.completed` is emitted only after all messages for the turn are appended to the bingo transcript. It does not wait for optional memory extraction.
11. `session.rename` and `session.delete` are accepted only while idle. `session.delete` emits its event, removes the transcript through bingo, and exits 0.
12. Fresh session allocation uses an exclusively created, UUID-suffixed transcript; 100 concurrent new-session launches in one workspace produce 100 distinct IDs and files.
13. EOF on stdin is a graceful close request while idle and a turn cancellation followed by close while busy.

The current `UiHooks` callback payloads do not carry a tool-use ID through `on_tool_ready`/`on_tool_done`. The bingo-side implementation must extend that internal interface (or add an equivalent correlated adapter seam) so the external `toolCallId` guarantee is real. Correlation by tool name, array position, or output text is forbidden.

### 4.5 Cancel, restart, and child termination

Normal cancel is cooperative:

1. Main sends `turn.cancel`.
2. bingo triggers the existing watch-based cancellation path.
3. bingo closes all ready tool rows as interrupted, repairs tool-use/tool-result pairing, persists the settled transcript, emits `turn.cancelled`, and remains ready.

Main starts a 750 ms cancel watchdog. If no terminal turn event arrives, it sends the platform's graceful termination signal and marks the turn interrupted locally. A process still alive 2 seconds later is force-killed. The replacement child always resumes the same exact transcript before accepting another prompt. A forced termination produces a page-level recovery error because transcript settlement could not be proven; it is never reported as a clean cancellation.

Every automatic replacement—forced-cancel recovery, crash Retry, or settings activation—is an explicit `SessionManager.reconnect` operation. It waits for the replacement child's `session.ready`, creates a new `connectionId`, resets the forwarded sequence to zero, and emits the sanitized renderer `session.reconnected` event defined in §6.3 before the composer is enabled. Failure leaves the old connection closed and the renderer in a recoverable page/flow error; it never keeps using a stale connection ID.

On app quit, main sends `session.close` to every managed child, waits up to 2 seconds, terminates remaining children, and force-kills at 3 seconds. This is the AC-F1-4 deadline.

### 4.6 Compatibility and capability failure

Ordinary invocations remain byte-compatible:

- `bingo --print` remains the existing plain streamed-text surface.
- TUI mode remains the default.
- JSON records appear only with explicit `--json-events`.

The GUI requires protocol v1 for the chat screen. It does **not** silently fall back to `--print`, because that would violate tool visibility and prompt safety. If the binary rejects `--json-events`, exits before `session.ready`, emits mixed stdout, or reports another protocol version, the GUI shows a flow-level `BINGO_PROTOCOL_UNSUPPORTED` error with the exact binary path and detected version. Within protocol v1, object schemas allow unknown fields for additive compatibility, but an unknown `type` is a protocol error that closes the child; lifecycle events are not safe to skip because doing so can leave a turn or prompt permanently unresolved.

A local HTTP server was rejected: stdio already provides process ownership, OS-level access control, natural shutdown, no port selection, and no local authentication problem. A PTY/TUI scraper and transcript tailing were rejected because neither exposes a complete, stable, correlated event stream.

## 5. Electron project structure

The developer should create this shape; file names may vary only if the same seams remain obvious.

```text
src/
  main/
    index.ts                    app lifecycle and single-instance lock
    createWindow.ts             BrowserWindow security policy
    ipc/registerIpc.ts          all channel registration and sender checks
    runtime/runtimeLocator.ts   binary resolution and version probe
    runtime/bingoSession.ts     BingoSession interface
    runtime/stdioBingoSession.ts
    runtime/sessionManager.ts
    storage/settingsRepository.ts
    storage/transcriptRepository.ts
    visual/capture.ts
  preload/
    index.ts                    contextBridge implementation only
  renderer/
    index.html
    src/
      main.tsx
      App.tsx
      state/appReducer.ts
      state/AppContext.tsx
      features/chat/
      features/sessions/
      features/settings/
      components/feedback/
      styles/
  shared/
    contracts/cli.ts            Zod schemas + inferred NDJSON types
    contracts/ipc.ts            Zod schemas + inferred IPC types/channel names
    contracts/settings.ts
    domain.ts
```

Rules:

- `shared/` contains data contracts and pure transformations only. It imports neither Electron nor Node-only modules.
- Renderer never imports from `main/` or `preload/`.
- Main never imports React or renderer modules.
- Only `preload/index.ts` imports `contextBridge`/`ipcRenderer`; it exposes the exact facade below, not raw Electron primitives.
- Child stdout parsing, transcript reading, settings writes, secrets, and transcript storage paths stay in main. The renderer receives only the explicit operational paths required by the PRD/tooling: resolved bingo binary, user settings file, workspace, and debug screenshot artifact.

## 6. Typed IPC contract

### 6.1 Channels

```ts
export const IPC = {
  appGetInfo: 'app:get-info',
  runtimeProbe: 'runtime:probe',
  sessionList: 'session:list',
  sessionOpen: 'session:open',
  sessionClose: 'session:close',
  sessionSend: 'session:send',
  sessionCancel: 'session:cancel',
  sessionRespondPrompt: 'session:respond-prompt',
  sessionRename: 'session:rename',
  sessionDelete: 'session:delete',
  sessionListModels: 'session:list-models',
  sessionEvent: 'session:event',
  settingsRead: 'settings:read',
  settingsSave: 'settings:save',
  visualCapture: 'visual:capture',
} as const
```

All invoke channels return a discriminated result rather than throwing expected operational errors:

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: GuiError }

type GuiError = {
  code: string
  msg: string
  level: 'field' | 'page' | 'flow'
  recoverable: boolean
  field?: string
  action?: 'retry' | 'reload' | 'open-settings' | 'choose-binary'
}
```

Unexpected programming errors may reject the invoke internally, but preload converts them to a generic flow-level result without renderer-visible stack traces.

### 6.2 Invoke payloads and results

```ts
type AppInfo = {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  packaged: boolean
}

type PromptResponse =
  | { kind: 'option'; optionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'cancel' }

type RuntimeProbeInput = {
  workspacePath: string
}

type RuntimeInfo = {
  binaryPath: string
  bingoVersion: string
  protocolVersion: 1
  workspacePath: string
}

type SessionSummary = {
  id: string                 // exact transcript stem; opaque outside main
  name: string               // rename suffix, otherwise project slug
  preview: string            // last visible user/assistant text, max 120 chars
  updatedAt: string          // ISO-8601 from file mtime
  messageCount: number
}

type TranscriptMessage = {
  id: string                 // deterministic from session ID + JSONL line/block
  role: 'user' | 'assistant'
  markdown: string
}

type TranscriptToolActivity = {
  id: string                 // persisted tool_use ID
  name: string
  summary: string
  status: 'done' | 'error' | 'interrupted'
  output: string
  durationMs: null           // duration is not persisted by current transcript schema
}

type SessionHistoryItem =
  | { type: 'message'; value: TranscriptMessage }
  | { type: 'tool'; value: TranscriptToolActivity }

type SessionOpened = {
  connectionId: string       // changes on every child spawn/restart
  metadata: Omit<CliSessionMetadata, 'transcriptPath'>
  history: SessionHistoryItem[]
}

type SessionListOutput = {
  sessions: SessionSummary[] // newest first
  warnings: string[]         // corrupt JSONL lines skipped, never fatal to the list
}
```

| Channel | Input | Success value | Semantics |
|---|---|---|---|
| `app:get-info` | `undefined` | `AppInfo` | No I/O beyond Electron metadata. |
| `runtime:probe` | `RuntimeProbeInput` | `RuntimeInfo` | Resolve binary, run `--version`, start/probe protocol with a 10s startup deadline. No shell. |
| `session:list` | `undefined` | `SessionListOutput` | Read transcript JSONL only; never mutate. |
| `session:open` | `{ sessionId: string | null; workspacePath: string }` | `SessionOpened` | `null` creates new; a string resumes exact ID. Closes the prior active child first. Resolves after `session.ready`. |
| `session:close` | `{ connectionId: string }` | `{ closed: true }` | Graceful child close; idempotent for an already-closed matching connection. |
| `session:send` | `{ connectionId: string; turnId: string; prompt: string }` | `{ accepted: true }` | Valid only in idle; returns after `turn.start` is written, not after completion. |
| `session:cancel` | `{ connectionId: string; turnId: string }` | `{ requested: true }` | Idempotent for the same active turn. |
| `session:respond-prompt` | `{ connectionId: string; turnId: string; promptId: string; response: PromptResponse }` | `{ accepted: true }` | Valid only for a live queued prompt on the current turn. Main atomically consumes the ID before writing; duplicate, stale, or cross-turn IDs return `STALE_PROMPT` and never reach bingo. |
| `session:rename` | `{ sessionId: string; name: string }` | `{ previousId: string; session: SessionSummary }` | Mutation is performed by bingo, never by Electron filesystem code. |
| `session:delete` | `{ sessionId: string }` | `{ deletedId: string }` | Renderer must confirm first. Mutation is performed by bingo. Active child is settled/closed. |
| `session:list-models` | `{ connectionId: string; provider: string }` | `{ provider: string; models: string[] }` | Provider must be present in the latest `providers.result`. bingo calls `client.with_provider(provider)?.list_models()`, so preset/settings/auth resolution is identical to turns and the active endpoint is not mutated. Resolves the matching `models.result`; 10s read timeout and sequence guard. |
| `settings:read` | `{ workspacePath: string }` | `SettingsSnapshot` | Reads layers and returns a redacted view plus revision. |
| `settings:save` | `SettingsSaveInput` | `SettingsSnapshot` | Revision check, validation, backup, atomic user-layer patch, then active-child restart on same session. 15s write timeout. |
| `visual:capture` | `VisualCaptureInput` | `{ absolutePath: string }` | Registered only under the visual-QA gate. Main chooses the destination path. |

`workspacePath` must be absolute, exist, and be a directory. Main canonicalizes it once and uses the canonical path as child `cwd`. Renderer cannot change it during a running turn.

### 6.3 Async event channel

Main validates every child event and sequence before forwarding it. It projects child events into a separate renderer-safe union; `CliEvent` is never forwarded wholesale. In particular, no renderer event contains `transcriptPath`, raw settings, credentials, or child diagnostics.

```ts
type RendererSessionMetadata = Omit<CliSessionMetadata, 'transcriptPath'>

type RendererCliPayload =
  | Extract<
      CliEvent,
      {
        type:
          | 'turn.started'
          | 'text.delta'
          | 'tool.ready'
          | 'tool.done'
          | 'prompt.request'
          | 'prompt.resolved'
          | 'providers.result'
          | 'models.result'
          | 'warning'
          | 'turn.completed'
          | 'turn.cancelled'
          | 'session.deleted'
          | 'session.closed'
          | 'error'
      }
    >
  | {
      type: 'session.renamed'
      commandId: string
      previousSessionId: string
      metadata: RendererSessionMetadata
    }

type RendererSessionEvent = {
  connectionId: string
  sequence: number
  payload:
    | RendererCliPayload
    | {
        type: 'session.reconnected'
        reason: 'cancel-recovery' | 'crash-retry' | 'settings-changed'
        previousConnectionId: string
        connectionId: string
        metadata: RendererSessionMetadata
      }
    | {
        type: 'transport.error'
        error: GuiError
        exitCode: number | null
        signal: string | null
      }
}
```

For `session.reconnected`, the envelope and payload carry the new `connectionId`, `sequence` is 1 for the new connection, and renderer atomically replaces its connection ID and resets its sequence/turn guards before processing later events.

Preload exposes subscription as a function returning an unsubscribe function. It does not expose `ipcRenderer.on`.

```ts
type BingoGuiBridge = {
  getAppInfo(): Promise<Result<AppInfo>>
  probeRuntime(input: RuntimeProbeInput): Promise<Result<RuntimeInfo>>
  listSessions(): Promise<Result<SessionListOutput>>
  openSession(input: { sessionId: string | null; workspacePath: string }): Promise<Result<SessionOpened>>
  closeSession(input: { connectionId: string }): Promise<Result<{ closed: true }>>
  sendTurn(input: { connectionId: string; turnId: string; prompt: string }): Promise<Result<{ accepted: true }>>
  cancelTurn(input: { connectionId: string; turnId: string }): Promise<Result<{ requested: true }>>
  respondToPrompt(input: { connectionId: string; turnId: string; promptId: string; response: PromptResponse }): Promise<Result<{ accepted: true }>>
  renameSession(input: { sessionId: string; name: string }): Promise<Result<{ previousId: string; session: SessionSummary }>>
  deleteSession(input: { sessionId: string }): Promise<Result<{ deletedId: string }>>
  listModels(input: { connectionId: string; provider: string }): Promise<Result<{ provider: string; models: string[] }>>
  readSettings(input: { workspacePath: string }): Promise<Result<SettingsSnapshot>>
  saveSettings(input: SettingsSaveInput): Promise<Result<SettingsSnapshot>>
  captureVisual(input: VisualCaptureInput): Promise<Result<{ absolutePath: string }>>
  onSessionEvent(listener: (event: RendererSessionEvent) => void): () => void
}
```

Every input is parsed with its Zod schema in preload and again in main. Main verifies that the sender is the current application window before handling a request.

## 7. Process lifecycle contract

### 7.1 States

```ts
type ProcessState =
  | { kind: 'absent' }
  | { kind: 'starting'; connectionId: string }
  | { kind: 'idle'; connectionId: string; sessionId: string }
  | { kind: 'running'; connectionId: string; sessionId: string; turnId: string }
  | { kind: 'awaiting-input'; connectionId: string; sessionId: string; turnId: string; promptIds: string[] }
  | { kind: 'cancelling'; connectionId: string; sessionId: string; turnId: string }
  | { kind: 'stopping'; connectionId: string; sessionId: string }
  | { kind: 'failed'; connectionId?: string; error: GuiError }
```

Allowed transitions:

```text
absent ─open──────────────> starting
starting ─session.ready───> idle
starting ─error/exit──────> failed
idle ─turn.start──────────> running
running ─prompt.request───> awaiting-input
awaiting-input ─resolved──> running (or stays awaiting-input while queued prompts remain)
running/awaiting-input ─cancel──> cancelling
running ─turn.completed───> idle
running/awaiting-input/cancelling ─turn.cancelled──> idle
running/awaiting-input/cancelling ─turn error──────> idle + page error
idle ─close───────────────> stopping ─exit────────> absent
any live state ─unexpected exit──> failed
failed ─retry─────────────> starting
```

`SessionManager` is the authoritative state machine. Renderer state mirrors it but cannot command an invalid transition. Main rejects a stale `connectionId`, mismatched `turnId`, duplicate submit, or operation while busy before writing to the child.

### 7.2 Stale-event protection

There are three guards, all required:

1. **Connection guard:** renderer accepts an event when its envelope `connectionId` equals the current connection. The sole exception is `session.reconnected`: accept it only when `payload.previousConnectionId` equals the current connection, envelope/payload new IDs are equal and different from the old ID, `sequence===1`, no newer connection has already been adopted, and metadata names the currently selected session. The reducer adopts the new ID and sequence atomically; every other event from either old or unknown IDs is discarded.
2. **Sequence guard:** main requires child `seq` to increase exactly; renderer requires forwarded `sequence` to increase.
3. **Turn guard:** turn events must match the current `turnId`.

A restart creates a new `connectionId`, even when it resumes the same transcript. Late events from the old child cannot overwrite new state. This is the AC-F6-3 mechanism, not a timing assumption.

### 7.3 Crash recovery

An unexpected child exit produces `transport.error` immediately. If a turn was active, its assistant row is marked interrupted, running tools are marked interrupted, and input returns to idle. Retry starts a new child with the same exact transcript ID. stderr is retained only in a bounded, redacted main-process diagnostic ring; renderer receives a safe message, exit code, and signal, never raw logs or secrets.

## 8. Transcript and session ownership

`TranscriptRepository` may read only:

```text
~/.local/share/bingo/transcripts/*.jsonl
```

It resolves `HOME` consistently with the bingo child. Session IDs are basenames without `.jsonl`; caller-provided paths are never joined directly. JSON mode reserves a UUID-suffixed transcript atomically before announcing a new session, so concurrent new conversations cannot share a file.

Read behavior mirrors bingo:

- sort by modification time descending;
- skip blank lines;
- validate each nonblank line against the version-1 `Message` schema;
- skip corrupt lines, count them, and return warnings instead of hiding the whole session;
- pair `tool_use.id` with later `tool_result.tool_use_id` for historical activity;
- never expose thinking signatures or base64 image data to renderer;
- normalize preview whitespace and cap previews at 120 characters.

A display name is the suffix after the transcript's Unix timestamp when one exists; otherwise it is the project slug. The exact full stem remains the opaque identity.

Electron does not rename, delete, append, truncate, or repair transcript files. Rename/delete IPC delegates to the bingo JSON process. “GUI is not a transcript writer” means no renderer, preload, or Electron-main filesystem code mutates JSONL; expected turn appends and requested rename/delete remain bingo-owned. Acceptance therefore compares browsing/rendering as byte-identical, attributes turn writes to the bingo child, and verifies no GUI-authored JSONL. This is the reconciled interpretation of AC-F3-5/AC-F3-6 recorded in `docs/acceptance.md`; a literal whole-directory no-change assertion during a real turn would contradict bingo persistence.

## 9. Settings contract and secret handling

### 9.1 Paths and precedence

Main resolves the same three layers as bingo:

1. `$XDG_CONFIG_HOME/bingo/settings.json`, otherwise `~/.config/bingo/settings.json`
2. `<workspace>/.bingo/settings.json`
3. `<workspace>/.bingo/local.json`

The GUI writes only layer 1. Layers 2 and 3 are read for source labels and write-shadow detection; the authoritative effective runtime snapshot and provider inventory come from bingo itself, not a TypeScript reimplementation of Rust merging.

Protocol v1 therefore requires `session.ready.metadata` for active scalar runtime values plus `providers.list`/`providers.result` for `Client::provider_names()` and each provider's resolved non-secret metadata. This result includes `default`, settings-defined providers after all three layers, and built-in `codex`/`opencode-go`, exactly matching bingo's own `/provider` set. `SettingsRepository` parses layer 1 only to perform a lossless patch and reads key presence in layers 2/3 only to identify fields a user-layer write cannot affect. Environment and preset fallback remain bingo-owned. Golden contract tests compare `providers.result` and active metadata against the same Rust client fixtures, including an active built-in absent from JSON.

If a higher layer shadows an editable key, that field is read-only and shows its source; writing an ineffective user value is rejected with `CONFIG_SHADOWED` before disk mutation.

### 9.2 Renderer-safe snapshot

```ts
type SecretState = {
  configured: boolean
  display: '••••••••' | ''
}

type ProviderView = {
  name: string
  apiBaseUrl: string
  protocol: 'anthropic' | 'openai'
  supportsImages: boolean
  builtin: boolean
  apiKey: SecretState
}

type SettingsValues = {
  apiBaseUrl: string
  apiKey: SecretState
  providers: ProviderView[]
  provider: string
  model: string
  thinkingLevel: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  permissionMode: string
  theme: 'auto' | 'dark' | 'light'
  sendImages: boolean
}

type SettingsSnapshot = {
  path: string
  revision: string            // SHA-256 of exact current user-layer bytes; missing file has a fixed sentinel
  effective: SettingsValues
  sources: Partial<Record<keyof SettingsValues, string>>
  shadowed: Array<keyof SettingsValues>
}

type SecretPatch =
  | { kind: 'unchanged' }
  | { kind: 'replace'; value: string }
  | { kind: 'clear' }

type ProviderPatch = {
  name: string
  apiBaseUrl?: string
  protocol?: 'anthropic' | 'openai'
  supportsImages?: boolean
  apiKey?: SecretPatch
}

type SettingsPatch = {
  apiBaseUrl?: string
  apiKey?: SecretPatch
  providers?: ProviderPatch[]
  provider?: string
  model?: string
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  permissionMode?: string
  theme?: 'auto' | 'dark' | 'light'
  sendImages?: boolean
}

type SettingsSaveInput = {
  workspacePath: string
  baseRevision: string
  patch: SettingsPatch
}
```

Raw stored keys are never returned by `settings:read`. A replacement key exists briefly in the renderer's password input and one IPC request; it must never be placed in global reducer state, devtools logs, analytics, toasts, error text, or snapshots.

### 9.3 Save algorithm

`SettingsRepository.save` performs one bounded transaction:

1. Validate paths and patch; reject unknown provider names and control characters.
2. Re-read user settings and compare SHA-256 to `baseRevision`; mismatch returns page-level `SETTINGS_CONFLICT` with Reload and writes nothing.
3. Parse all layers. Any parse failure identifies the exact file, returns `CONFIG_INVALID`, and writes nothing.
4. Validate URLs and enums. Provider names must exist in the latest `providers.result`. Before accepting a model change, call `models.list` for the selected provider; a model not in a successful non-empty result is a field-level error and writes nothing. If the provider returns `Unsupported` or an empty model list, manual model entry is allowed with a visible “not verified by provider” note and the real next-turn provider error remains authoritative; transport/auth/list failures are page errors and do not authorize the write.
5. Apply only patch keys to the existing user-layer JSON object. Preserve every unknown top-level key and unknown nested provider key.
6. Create `settings.json.bak-<UTC timestamp>` from the exact pre-edit bytes when the file exists.
7. Write a same-directory temporary file with restrictive permissions, flush it, and atomically replace the destination. Use the mature `write-file-atomic` package rather than an ad hoc cross-platform replacement sequence.
8. Re-read, parse, and hash the result; return the new redacted snapshot.
9. If provider/model/thinking/runtime-affecting values changed, gracefully restart the idle active child on the same exact session. This is not an app restart; the next turn uses the new settings.

No save is allowed while a turn is running or awaiting input. UI offers Cancel turn first. Short reads use 10 seconds, writes 15 seconds; agent turns and user prompts have no short-operation timeout.

## 10. Renderer state and event reduction

Use one `AppContext` with `useReducer`. Keep state serializable except for transient input refs.

```ts
type AppState = {
  boot:
    | { kind: 'loading' }
    | { kind: 'ready'; app: AppInfo; runtime: RuntimeInfo }
    | { kind: 'error'; error: GuiError }
  sessions: {
    status: 'idle' | 'loading' | 'error'
    items: SessionSummary[]
    activeId: string | null
    error?: GuiError
  }
  chat: {
    connectionId: string | null
    lastSequence: number
    phase: 'empty' | 'idle' | 'running' | 'awaiting-input' | 'cancelling' | 'error'
    turnId: string | null
    items: SessionHistoryItem[]
    promptQueue: Array<Extract<CliEvent, { type: 'prompt.request' }>>
    error?: GuiError
  }
  settings: {
    status: 'idle' | 'loading' | 'saving' | 'error'
    snapshot: SettingsSnapshot | null
    error?: GuiError
  }
  toasts: Array<{
    id: string
    kind: 'success' | 'error' | 'info'
    text: string
    paused: boolean
  }>
}
```

Reducer rules:

- Optimistically append the user message only after `session:send` returns `{accepted:true}`; keep the composer draft until then.
- Create one assistant streaming item at `turn.started`; append only matching `text.delta` values.
- `tool.ready` inserts a running row; `tool.done` updates only the matching ID.
- A terminal turn event settles the assistant row, clears delayed loading, closes prompts, and re-enables input.
- Unknown or invalid transitions are ignored and reported to a development-only diagnostic hook; they never mutate visible state.
- Loading UI is delayed 200 ms. Completion before the threshold cancels the timer, preventing flashes.
- Toasts last 3 seconds, pause on hover/focus, and cap at two; adding a third removes the oldest non-paused toast.
- Error focus moves after React commits the error region. Error/toast regions use `aria-live` according to severity.

No server-state library is needed. Transcript/settings operations are request/response and the child is an ordered event source, not a cache synchronization problem.

## 11. UI module inventory by milestone

| Milestone | UI modules | Contract exercised |
|---|---|---|
| M0 | `AppShell`, primary navigation, `RuntimeStatus`, `VersionBadge`, chat placeholder, `FlowError`, retry action | `app:get-info`, `runtime:probe`, window lifecycle, 800×600 layout |
| M1 | `ChatTranscript`, `MessageRow`, `MarkdownMessage`, `PromptComposer`, `TurnIndicator`, `ToolActivityLog`, `ToolActivityRow`, `PromptDialog`, `InlineTurnError`, delayed `LoadingIndicator` | session open/send/cancel/events, tool correlation, prompt transport, Markdown escaping |
| M2 | `SessionList`, `SessionListItem`, `NewConversationButton`, `RenameDialog`, `DeleteConfirmationDialog`, `ProviderModelPicker`, `ThinkingPicker`, `SettingsScreen`, masked secret fields, `ToastRegion` | transcripts, exact resume, bingo-owned rename/delete, models, settings transaction/restart |
| M3 | `WelcomeEmptyState`, `ConversationEmptyState`, skeletons, field/page/flow error variants, focus management, dark/light theme tokens, reduced motion, responsive refinements | feedback-state timings, accessibility, visual matrix, crash/stale-event recovery |

Markdown uses `react-markdown` plus `remark-gfm`. Do not add `rehype-raw`; raw model HTML remains escaped. Links open only after main validates an `https:` URL and explicit user action. Model content cannot invoke IPC.

Tool rows are collapsed by default, show name/summary/status/duration, and may reveal clipped output on explicit expansion. Errors remain visible without expansion.

## 12. Security model

Every `BrowserWindow` uses:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  preload: ABSOLUTE_PRELOAD_PATH,
}
```

Required controls:

- A restrictive CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- Deny `will-navigate` away from the application URL.
- `setWindowOpenHandler` denies all windows; validated external `https:` links use a dedicated main action.
- Deny all Electron permission requests.
- Acquire `app.requestSingleInstanceLock()` so two GUI processes cannot concurrently manage the same child/settings transaction.
- Validate IPC sender identity, channel, payload, path canonicalization, and operation state in main.
- Never interpolate input into shell commands. Use `spawn(binaryPath, args, { shell: false, cwd })`.
- Bound stdout/stderr buffers and stop parsing on malformed framing.
- Do not log prompts, model output, tool output, API keys, full settings JSON, or raw child environment by default.
- DevTools are enabled in development only. Packaged builds require an explicit development flag.
- Renderer never receives `transcriptPath`, raw secret values, arbitrary filesystem handles, or the ability to choose a screenshot destination. It may receive only four user-visible/QA operational paths through typed contracts: the resolved bingo binary, canonical workspace, user settings file, and generated screenshot artifact.

## 13. Technology and dependency choices

### Runtime

- Electron
- TypeScript with `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`
- React + React DOM
- Zod for runtime contracts
- `react-markdown` + `remark-gfm`
- `write-file-atomic` for settings replacement

### Build/package

- `electron-vite` builds main, preload, and renderer separately.
- `electron-builder` creates unpacked and distributable artifacts.
- npm with a committed lockfile; CI uses `npm ci`.
- The packaged app includes a target-specific bingo binary under `resources/bin/<platform>-<arch>/`.

Binary resolution is deterministic:

1. absolute `BINGO_GUI_BINARY` environment override (development/QA worktree binary);
2. packaged resource binary;
3. `bingo` resolved from `PATH` for an unpackaged local run.

An explicitly configured/overridden path that is absent or non-executable fails; it does not silently fall through to a different binary. The status area always shows the exact resolved path and version.

Workspace resolution is similarly explicit: absolute `BINGO_GUI_CWD`, otherwise the canonical process launch directory. A workspace chooser is outside v0.1; the resolved workspace is visible in status/settings so the user is never misled about tool cwd.

M0 is not complete on a renderer-only dev server. It requires:

1. `npm run dev` launch smoke;
2. production bundle build;
3. `electron-builder --dir` unpacked-app launch smoke;
4. bundled/selected `bingo --version` and protocol-v1 smoke.

### Testing

- **Vitest:** reducers, Zod contracts, transcript projection, settings validation/revision logic, NDJSON framing.
- **React Testing Library:** composer duplicate prevention, event rendering, dialogs, delayed loaders, error focus, toasts, empty states.
- **Main integration tests:** fake child executable emits controlled split chunks, malformed lines, sequence gaps, crashes, prompt requests, duplicate tool names, and late events.
- **Real bingo contract tests:** run against the worktree binary with isolated `HOME`, `XDG_CONFIG_HOME`, and workspace. Assert stdout is pure NDJSON, stderr is not parsed, exact session resume, cancellation settlement, correlated tools, and plain `--print` compatibility.
- **Playwright Electron:** dev and packaged window launch, send/cancel flow, missing binary, resize, settings round trip, session resume, clean process exit.
- **Visual QA:** deterministic PNG matrix described below.

Spectron, Redux, Zustand, a local web server, a database, and a custom design-system package are intentionally not added.

## 14. Visual-QA screenshot pipeline

Main owns capture through `BrowserWindow.webContents.capturePage()`. The IPC channel exists only when either:

```text
!app.isPackaged
```

or

```text
BINGO_GUI_VISUAL_QA=1
```

The renderer may request only enumerated state metadata:

```ts
type VisualCaptureInput = {
  runId: string
  theme: 'dark' | 'light'
  state: 'chat' | 'empty' | 'loading' | 'error'
  viewport: '1440x900' | '800x600'
}
```

Main sanitizes `runId`, sets the requested content size, captures the page, and writes PNGs only beneath:

```text
/Users/yexrob/Episodes/Projects/bingo-gui/screenshots/<runId>/<theme>/<state>-<viewport>.png
```

The path is generated in main; renderer cannot supply a path. `screenshots/` stays gitignored.

Before requesting capture, the QA harness waits for:

1. the target state marker (`data-qa-state`) to match;
2. `document.fonts.ready`;
3. two animation frames;
4. motion to be disabled for deterministic output.

The required M3 matrix is dark and light × chat, empty, loading, and error at 1440×900, plus all four states at the minimum 800×600 viewport. `gui-vision` receives the resulting absolute PNG paths and reports measurable issues. A capture is evidence, not approval; M3 closes only after the vision review has no open criticals.

## 15. Milestone implementation order

### M0

1. Scaffold the secure Electron shell and shared IPC contracts.
2. Implement runtime locator and protocol probe.
3. Implement missing/unsupported binary flow-level states.
4. Package the selected protocol-v1 bingo binary and run dev/unpacked smoke tests.

### Bingo-side prerequisite for M1

In the approved bingo worktree:

1. add `--json-events` and exact `--session` parsing;
2. add serializable v1 command/event types and contract tests;
3. implement the persistent command loop over existing `Session`/`run_query`;
4. make the event writer the sole stdout writer in JSON mode;
5. carry stable tool-use IDs through ready/done callbacks;
6. implement structured prompts, model listing, cancellation, rename/delete/close;
7. prove ordinary TUI and `--print` output are unchanged.

No GUI implementation may fake tool visibility to declare M1 complete.

### M1

1. Implement `StdioBingoSession` and `SessionManager`.
2. Implement the reducer and chat transcript/composer.
3. Add tool rows, prompt dialogs, cancel, Markdown, and terminal error handling.
4. Run the real-binary end-to-end contract suite.

### M2

1. Add read-only transcript projection/list/history.
2. Add exact resume and bingo-owned rename/delete.
3. Add provider/model listing and picker.
4. Add settings transaction, secrets, restart-on-save, and integrity tests.

### M3

1. Finish feedback-state timing, stale guards, accessibility, and themes.
2. Generate the complete screenshot matrix and iterate with `gui-vision`.
3. Run packaged acceptance, orphan-process loops, and the full QA checklist.

## 16. Rejected alternatives and trade-offs

- **One `--print` process per turn:** superficially small, but cannot expose tools or framed prompts and `--continue` can select the wrong transcript. Rejected.
- **Persistent TUI under a PTY:** preserves behavior but makes ANSI rendering, terminal size, key simulation, and human copy into an accidental protocol. Rejected.
- **Tail transcript files for events:** transcripts settle messages, not live lifecycle; they omit reliable durations and current callback IDs. Rejected.
- **Electron calling providers directly:** duplicates bingo's provider adapters, permissions, tools, hooks, memory, and transcript semantics. Rejected.
- **Embed Rust through FFI/native Node modules:** creates ABI, signing, crash-containment, and cross-platform build costs without product benefit. Rejected.
- **Local HTTP server:** adds port/auth/firewall and orphan-server concerns that child stdio avoids. Rejected.
- **Direct transcript mutation by Electron:** violates the single-writer constraint. Rejected.
- **Shelling TUI slash commands for settings:** requires terminal emulation and parses presentation text. Rejected.
- **Write project/local settings layers:** risks modifying repository state and still cannot guarantee user intent. Rejected; shadowed fields are explicit.
- **Silent plain-text fallback:** would hide tool calls and violate AC-F2-3. Rejected.

The chosen architecture deliberately pays for one small, versioned upstream adapter. In return, the Electron application remains a front end rather than a second agent harness, and all independently consumed seams are explicit and testable.
