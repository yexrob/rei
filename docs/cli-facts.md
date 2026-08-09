# bingo CLI ground-truth contract

> Audited for `bingo-gui` on 2026-08-10. The reference checkout was read-only:
> `/Users/yexrob/Episodes/Projects/bingo` at commit
> `0c4d431d27708528b8c3ece59fee83259f3fe935`, package/binary version `0.3.3`.
> Unless an observation explicitly says `debug`, commands used the release binary and
> captured stdout and stderr separately with non-TTY pipes. Secrets are intentionally omitted.

## 1. Executive integration facts

1. Both expected binaries already exist and report `bingo 0.3.3`:
   - `/Users/yexrob/Episodes/Projects/bingo/target/debug/bingo`
   - `/Users/yexrob/Episodes/Projects/bingo/target/release/bingo`
   No build was required.
2. `bingo --print` is the only general-purpose headless mode. It performs one complete agent
   query and streams assistant **text deltas** to stdout, flushing each delta. Ordinary completion
   appends a newline, but some post-tool early-return paths do not. It has no JSON/NDJSON or other
   structured success-output option.
3. Existing headless hooks discard tool-start, tool-ready, tool-done, thinking, token-count, and
   round-boundary events. Tool activity is therefore not observable from the process output.
4. Headless status, warnings, permission questions, and final errors use stderr. stdout is only
   assistant text plus the final newline in the normal headless query path.
5. Piped stdin can supply a prompt, but the process calls `read_to_string` and waits for EOF before
   starting the query. The same stdin is later reused for permissions and `AskUserQuestion`, so a
   one-shot piped prompt leaves those reads at EOF. A bidirectional GUI protocol cannot safely
   reuse this contract.
6. A propagated runtime failure exits `1`. With non-TTY stderr, its final line is
   `[error] code=<SCREAMING_SNAKE> msg=<single line up to 200 Unicode characters>`.
   clap parse/usage failures instead exit `2` and print clap's unstructured diagnostic.
7. `--model` exists; there is **no `--provider` flag**. The provider is restored from layered JSON
   settings. An invalid configured provider warns and silently falls back to `default`.
8. `--continue` resumes only the most recently modified transcript globally. There is no CLI flag
   that selects an exact session. A transcript path is allocated before a query, but the file is
   created only on append; same-project processes started in the same second can collide on a path.
9. Missing settings files are valid and mean defaults; malformed settings fail before querying
   with `CONFIG_INVALID`. The default provider's credentials come from top-level settings first,
   then environment variables; named providers use their own config/stored-auth mechanisms.
10. `bingo-gui` needs a minimal opt-in structured event transport upstream; §10 records the gap
    and a schema proposal. Existing `--print` behavior must remain unchanged.

## 2. Binary and help surface

### Binary discovery

Observed:

```text
FOUND /Users/yexrob/Episodes/Projects/bingo/target/debug/bingo
bingo 0.3.3
FOUND /Users/yexrob/Episodes/Projects/bingo/target/release/bingo
bingo 0.3.3
```

The binaries were newer than `src/main.rs`, and `Cargo.toml` also declares version `0.3.3`.

### Exact `bingo --help`

```text
Rust agent CLI

Usage: bingo [OPTIONS] [PROMPT]...
       bingo <COMMAND>

Commands:
  share   Export a session to local HTML by default; use --public to publish it
  update  Update bingo to the latest GitHub release (SHA-256 verified, atomic replace)
  help    Print this message or the help of the given subcommand(s)

Arguments:
  [PROMPT]...  

Options:
  -p, --print
          Headless mode: print the reply straight to stdout
      --fullscreen
          Fullscreen mode (default): alternate-screen canvas, input pinned at the bottom, and in-app scrolling. Retained as an explicit compatibility flag
      --inline
          Inline mode: finalized output stays in the terminal scrollback
      --model <MODEL>
          Model to use (defaults to settings `model`, then the built-in default)
      --no-team
          Do not auto-start the project team (overrides settings `team.autoStart`; D31)
      --permission-mode <PERMISSION_MODE>
          Permission mode (defaults to the settings)
      --continue
          Resume the most recent session
  -h, --help
          Print help
  -V, --version
          Print version
```

Source: [`src/main.rs:47-117`](../../bingo/src/main.rs) defines the complete clap surface.
The accepted permission modes are exactly `default`, `acceptEdits`, `bypassPermissions`,
`dontAsk`, and `plan` (`src/permission.rs:3-24`).

GUI-relevant absences are as important as the flags above:

- no `--provider`;
- no `--session <id>` / exact-resume selector;
- no `--json`, `--json-events`, or output-format flag in the audited version;
- no server, socket, or persistent stdio mode;
- no `--verbose` despite a stale `detail=` mention in an error-code comment;
- no CLI attachment flag.

### Subcommands

Exact `bingo share --help`:

```text
Export a session to local HTML by default; use --public to publish it

Usage: bingo share [OPTIONS] [SESSION]

Arguments:
  [SESSION]  Session key: transcript stem (`{slug}-{ts}`) or a matching fragment; defaults to the latest session (/resume semantics)

Options:
      --public           Publish the generated page to a publicly accessible share URL
  -o, --output <OUTPUT>  Output file path (default `<session>.html` in the current directory; local export and upload fallback)
      --open             Open the generated page in the system default browser (link in upload mode, file in local mode)
  -h, --help             Print help
```

`update` also exists with `--check`. Both subcommands take a fast path before settings/API setup
(`src/main.rs:144-158`) and are not chat transports.

## 3. Headless process contract

### Invocation and prompt assembly

`--print` enters the headless branch (`src/main.rs:385-411`). If positional prompt words exist,
they are joined with one ASCII space. This observed command:

```sh
bingo --print --no-team --permission-mode dontAsk \
  Reply with exactly ARG_JOIN_OK and nothing else.
```

returned:

```text
stdout: ARG_JOIN_OK\n
stderr: [bingo] context: 959 tokens\n
exit:   0
```

If no positional prompt exists:

- TTY stdin fails immediately rather than blocking;
- non-TTY stdin is read **completely to EOF**, then outer whitespace is trimmed;
- empty/whitespace-only input fails.

Source: `src/main.rs:387-404`.

### Output is incremental

`headless_hooks` writes only `StreamEvent::TextDelta.text` to stdout and flushes immediately after
each delta (`src/query.rs:309-321`). `query_loop` prints one newline when the assistant finishes
without further tools (`src/query.rs:782-813`).

A timed live run used a piped prompt `Reply with exactly PIPE_OK and nothing else.`. Observed byte
reads from the child were:

```text
+0.246s stderr b'[bingo] context: 954 tokens\n'
+0.945s stdout b'P'
+0.971s stdout b'IPE_OK'
+0.971s stdout b'\n'
exit=0, total elapsed=2.249s
```

This proves output can be consumed progressively; it is not withheld until process exit. OS pipe
reads are not event boundaries, however—the GUI must treat stdout as an arbitrary byte stream.
UTF-8 decoding must preserve incomplete multibyte sequences across chunks.

### Tool activity is intentionally invisible

Current headless hooks are:

```rust
on_tool_ready: Box::new(|_name, _input, _standalone| {}),
on_tool_done: Box::new(|_| {}),
on_round_end: Box::new(|| {}),
```

Source: `src/query.rs:318-320`. `on_event` forwards only `TextDelta`, so `ToolUseStart`, thinking,
and output-token events are also discarded (`src/query.rs:312-317`).

A real run instructed the agent to execute `printf TOOL_MARKER`, then answer `TOOL_DONE`.
Observed process output:

```text
stdout: TOOL_DONE\n
stderr: [bingo] context: 965 tokens\n
        [bingo] context: 1118 tokens\n
exit:   0
```

Neither the tool name, input, status, nor result appeared in process output. The transcript did
contain the full tool exchange:

```json
{"role":"assistant","content":[{"type":"thinking","thinking":"","signature":"…"},{"type":"tool_use","id":"call_…","name":"Bash","input":{"command":"printf TOOL_MARKER"}}]}
{"role":"user","content":[{"type":"tool_result","tool_use_id":"call_…","content":"$ printf TOOL_MARKER\nTOOL_MARKER\n[Exited with code 0]"}]}
{"role":"assistant","content":[{"type":"thinking","thinking":"","signature":"…"},{"type":"text","text":"TOOL_DONE"}]}
```

Watching transcript files is not a sound substitute for live events: files are persistence, have
no explicit running state/duration contract, and couple the GUI to implementation details.

### stdout and stderr roles

For a normal `--print` query:

| Stream | Current content |
|---|---|
| stdout | Raw assistant text deltas; ordinary completion and primary interruption paths append a newline, but the post-tool early-return path at `src/query.rs:986-990` does not |
| stderr | `[bingo] ...` progress/warnings; `[team] ...` startup state when a team auto-starts; interactive permission/question prompts; final error line |

A provider stream can deliver text deltas and then fail. In that case stdout contains a partial
assistant reply, stderr ends with `[error] ...`, and exit is `1`. Because `record` runs only after
`one_turn` returns successfully (`src/query.rs:772-785`), that partial assistant message is not
persisted as a completed transcript message. The GUI must retain it only as visibly incomplete
turn output and must use the terminal event/exit status—not non-empty stdout—to decide success.

Notable progress lines can repeat once per tool/model round, e.g. `[bingo] context: N tokens`.
They are not structured events and must not be rendered as assistant content.

`--no-team` is advisable for deterministic GUI child behavior unless the product explicitly wants
project-team startup. Without it, a project `.bingo/team.json` can spawn agents and write
`[team] ...` status to stderr (`src/main.rs:348-383`).

### Permissions and `AskUserQuestion`

Headless permission prompts use stderr and synchronously read a line from stdin:

```text
Allow <Tool> to run? (<reason>) [y/N] 
```

Only case-insensitive `y` or `yes` allows (`src/query.rs:288-306`). `AskUserQuestion` prints a
multi-line menu to stderr and reads either a 1-based option number, free text, or an empty line to
skip (`src/query.rs:323-355`).

This conflicts with piped-prompt input: main first executes `stdin.read_to_string`, which cannot
return until the GUI closes stdin. Later interactive reads therefore receive EOF. It is possible
to avoid prompts with `dontAsk` (deny non-read-only tools) or `bypassPermissions` (unsafe broad
allow), but neither preserves the intended approval UX. This is a blocking transport gap.

## 4. Error and exit-status contract

### Runtime errors

Top-level propagated failures call `report_error` and exit `1` (`src/main.rs:119-127`). The
presentation depends on **whether stderr is a TTY**, not whether `--print` was passed:

- non-TTY stderr:
  `[error] code=<SCREAMING_SNAKE> msg=<single-line-message>`;
- TTY stderr:
  `Error: <unsanitized display message>`.

Source: `src/main.rs:529-540`.

For the non-TTY line:

- `code` is selected by walking the error cause chain (`src/error.rs:112-130`);
- stable codes use `SCREAMING_SNAKE` and are add-only (`src/error.rs:1-26`);
- unregistered errors use `GENERIC`;
- `msg` replaces newline, tab, and carriage return with spaces and keeps at most 200 **Unicode
  characters** (`src/error.rs:85-102`);
- there is no escaping or quoting around spaces or `=` inside `msg`; parse by the fixed prefix and
  split once at ` msg=`, not by whitespace;
- earlier stderr warning/progress lines may precede the final `[error]` line.

A release binary emits only the contract line for a generic error. A debug binary additionally
emits an unstable diagnostic first:

```text
[bingo] error: "no prompt provided (stdin was empty)" uses GENERIC (missing stable error code)
```

Source: debug-only `missing_code`, `src/error.rs:68-77`. The GUI should use a release binary for
stable stderr or explicitly ignore `[bingo] error:` diagnostics.

### clap usage errors

clap owns argument parsing before `run()` can return. Invalid syntax exits `2`, not `1`, and does
**not** use `[error]`:

```text
error: unexpected argument '--definitely-nope' found

  tip: to pass '--definitely-nope' as a value, use '-- --definitely-nope'

Usage: bingo --print [PROMPT]...

For more information, try '--help'.
```

The GUI must distinguish exit `2` usage/configuration of the child invocation from runtime exit
`1`.

### Stable runtime code families observed/source-mapped

Client errors map as follows (`src/api/contract.rs:51-70`):

| Condition | Code |
|---|---|
| Missing/invalid key, OAuth/auth issue, HTTP 401 | `AUTH_REQUIRED` |
| HTTP 403 | `PERMISSION_DENIED` |
| HTTP 429 | `RATE_LIMITED` |
| Other API/stream/unsupported operation | `SERVER_ERROR` |
| Transport failure | `OFFLINE` |
| Request timeout | `TIMEOUT` |
| Provider configuration error | `CONFIG_INVALID` |

Other modules add codes such as `TOOL_FAILED`, `STORAGE_ERROR`, and `HOOK_FAILED`; the registry is
in `src/error.rs:119-160`. The GUI must preserve unknown future SCREAMING_SNAKE codes rather than
hard-failing its parser.

## 5. Exact edge-case observations

All paths below were isolated temporary HOME/XDG directories; credentials were unset unless noted.

### Empty piped stdin

Release binary:

```text
command: printf '' | bingo --print --no-team
stdout:  (empty)
stderr: [error] code=GENERIC msg=no prompt provided (stdin was empty)
exit:   1
```

Whitespace-only stdin produced exactly the same result.

### No prompt with TTY stdin/stderr

Observed under a PTY:

```text
Error: no prompt provided (pass a prompt argument or pipe stdin)
```

Exit was `1`; no `[error]` line appears because stderr is a TTY.

### Missing config and credentials

A nonexistent XDG settings directory is accepted. The query then fails for missing credentials:

```text
stdout:  (empty)
stderr: [bingo] warning: count_tokens unavailable (missing credentials: set apiKey in ~/.config/bingo/settings.json, export ANTHROPIC_API_KEY, or run /provider login codex (ChatGPT subscription)); falling back to a local estimate for auto-compact
        [bingo] context: 952 tokens
        [error] code=AUTH_REQUIRED msg=missing credentials: set apiKey in ~/.config/bingo/settings.json, export ANTHROPIC_API_KEY, or run /provider login codex (ChatGPT subscription)
exit:   1
```

Therefore “missing config” itself is not an error; absence and corrupt JSON must be presented
differently.

### Malformed config

With `{bad json` in the user settings file:

```text
stdout:  (empty)
stderr: [error] code=CONFIG_INVALID msg=failed to parse settings /tmp/…/xdg/bingo/settings.json: key must be a string at line 1 column 2
exit:   1
```

The error contains the concrete offending layer path.

### Unknown configured provider

With `provider: "removed-provider"`, bingo did not fail startup. It emitted:

```text
[bingo] warning: provider "removed-provider" is no longer valid, falling back to default: provider "removed-provider" not found (see /provider for the list)
```

It then queried the default endpoint. Source confirms warning + fallback (`src/main.rs:286-303`).
The settings value is not automatically repaired.

### Unknown model

`--model` accepts an arbitrary string locally; there is no CLI allowlist validation. Against the
configured endpoint, an intentionally invalid model produced:

```text
stdout:  (empty)
stderr: [bingo] warning: count_tokens unavailable (API error: HTTP 400: {"error":{"message":"The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed totally-nonexistent-model.","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}); falling back to a local estimate for auto-compact
        [bingo] context: 978 tokens
        [error] code=SERVER_ERROR msg=API error: HTTP 400: {"error":{"message":"The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed totally-nonexistent-model.","type":"invalid_request_error","param":null
exit:   1
```

The final message is truncated at 200 characters. “Unknown model” is endpoint-defined and currently
maps to generic `SERVER_ERROR` for HTTP 400, not a dedicated field-validation code. The GUI must
not promise reliable offline model validation from this interface.

### Invalid permission mode

```text
stdout:  (empty)
stderr: [error] code=GENERIC msg=unknown permission mode: nonsense (expected default|acceptEdits|bypassPermissions|dontAsk|plan)
exit:   1
```

### `--continue` with no prior transcript

It allocates a fresh transcript path and behaves as a new session; it does not error because no
session exists (`src/main.rs:226-246`). The file appears only when a message is appended.

## 6. Settings location, layering, and schema

### Paths and precedence

`XDG_CONFIG_HOME` is honored. The three JSON layers, lowest to highest precedence, are
(`src/settings.rs:256-280`, `411-420`):

1. `$XDG_CONFIG_HOME/bingo/settings.json`, or `~/.config/bingo/settings.json` when XDG is unset;
2. `<cwd>/.bingo/settings.json`;
3. `<cwd>/.bingo/local.json`.

The launch **working directory changes effective settings and project identity**. Electron must
spawn bingo with the selected project directory as `cwd`, not with an arbitrary app directory.

Merging is field-specific rather than a generic deep merge (`src/settings.rs:284-383`): most
scalars override; provider maps extend/replace entries; permission arrays extend; disabled MCP
servers extend; several hook arrays replace when non-empty. A GUI that displays “effective
settings” must implement this exact merge or ask bingo through a future structured interface.
A GUI write should modify only the intended layer and preserve unknown keys.

### Recognized top-level keys

The source lint table is (`src/settings.rs:385-409`):

```text
apiKey
apiBaseUrl
providers
provider
model
sendImages
thinkingLevel
permissionMode
theme
motion
cacheControl
respondToBashCommands
shell
hooks
mcpServers
disabledMcpServers
permissions
experimental
team
share
```

Unknown top-level fields are accepted by serde, warned about at startup, and ignored. This makes a
read-modify-write preservation strategy mandatory.

### Schema relevant to the GUI

A representative shape, with secrets replaced by placeholders:

```json
{
  "apiKey": "<secret>",
  "apiBaseUrl": "https://example.invalid",
  "providers": {
    "name": {
      "apiKey": "<secret, optional for OAuth>",
      "apiBaseUrl": "https://example.invalid",
      "protocol": "anthropic | openai",
      "oauth": {
        "kind": "codex",
        "account": "<optional; currently parsed but unused>"
      },
      "supportsImages": true
    }
  },
  "provider": "default | <provider name>",
  "model": "<model id>",
  "sendImages": true,
  "thinkingLevel": "off | low | medium | high | xhigh | max",
  "permissionMode": "default | acceptEdits | bypassPermissions | dontAsk | plan",
  "theme": "auto | dark | light",
  "motion": "auto | off",
  "cacheControl": false,
  "respondToBashCommands": true,
  "shell": "/bin/zsh",
  "hooks": {
    "PreToolUse": [{"matcher": "...", "hooks": [{"type": "command", "command": "..."}]}],
    "PostToolUse": [],
    "PreCompact": [],
    "PostCompact": [],
    "UserPromptSubmit": [],
    "Stop": [],
    "SessionStart": [],
    "SessionEnd": [],
    "TaskCreated": [],
    "TaskCompleted": []
  },
  "mcpServers": {
    "name": {
      "type": "stdio | http",
      "command": "...",
      "args": [],
      "env": {},
      "url": "...",
      "headers": {}
    }
  },
  "disabledMcpServers": [],
  "permissions": {"allow": [], "deny": [], "ask": []},
  "experimental": {
    "agentChannels": false,
    "channelMessageLimit": 500,
    "agentMessageLimit": 50
  },
  "team": {"autoStart": true},
  "share": {"baseUrl": "https://bingo.ruobin.dev"}
}
```

Source structs: `src/settings.rs:41-253`.

### Credential and endpoint precedence

For the default provider (`src/api/client.rs:89-114`):

- API key: top-level `apiKey`, then `ANTHROPIC_API_KEY`, then `DEEPSEEK_API_KEY`;
- base URL: top-level `apiBaseUrl`, then `ANTHROPIC_BASE_URL`, then the Anthropic default;
- no key produces an unconfigured client so the interactive TUI can still offer login; a headless
  request then fails `AUTH_REQUIRED`.

A named provider defaults to Anthropic protocol unless `protocol: "openai"` is set. Missing/empty
base URLs fall back by protocol. The runtime provider table always also contains two compile-time
presets even when `settings.providers` does not mention them:

- `codex` — OpenAI protocol, ChatGPT-subscription OAuth, images enabled;
- `opencode-go` — OpenAI protocol, stored API key, images disabled, model `gpt-5.6-luna`.

User `providers.codex` / `providers.opencode-go` entries override the matching preset
field-by-field; absent fields retain preset values. The settings JSON itself remains user-only—the
presets are added while building `Client` (`src/api/providers/presets.rs:1-50`,
`src/api/client.rs:118-173`). Therefore “providers present in settings plus default” is not the
same list as bingo's effective provider table; PRD `AC-F4-1` needs reconciliation with this source
fact.

Do not log actual settings values: the audited user file contains credential fields. This report
records only field names and selection behavior.

## 7. Model and provider selection

### Model

Precedence is explicit (`src/main.rs:274-280`):

1. `--model <MODEL>`;
2. effective layered `settings.model`;
3. built-in `claude-sonnet-5` (`src/api/types.rs:3`).

The model flag overrides for one process only; it does not persist settings.

### Provider

There is no provider CLI flag. `settings.provider` is restored at startup. A valid name switches
the client; an invalid name warns and remains on `default` (`src/main.rs:286-303`). Interactive
`/provider` and `/model` menus persist selections through scoped settings, but that slash-command
path is not available as a headless configuration API.

This creates a GUI race if it edits a global settings provider merely to launch one child. A
future transport should accept provider per session/turn or establish it at connection startup.

## 8. Sessions and persistence

Transcripts are JSONL, one serialized `Message` per line (`src/transcript.rs:25-28`), under:

```text
~/.local/share/bingo/transcripts/<project-slug>-<unix-seconds>.jsonl
```

Source: `src/transcript.rs:49-71`. The project slug derives from the child process `cwd` basename.
Messages include user/assistant roles and text, thinking, tool-use, tool-result, and image content
blocks (`src/api/types.rs`).

Behavior:

- a normal invocation allocates a transcript **path** before the query, but `Transcript::create`
  does not create the file; the first recorded message opens/appends it (`src/transcript.rs:57-71`,
  `101-133`, `src/query.rs:1025-1037`);
- path names have only one-second timestamp resolution. Two processes with the same `cwd` basename
  started in one second allocate the same path and can interleave appends. This is a concrete
  concurrency hazard for one-process-per-turn/multi-conversation designs;
- a failure before the first `record` can leave no file; after the user message is recorded, a
  request failure can leave a transcript containing only that user turn;
- `--continue` loads the most recently modified transcript returned by the global transcript list,
  not the latest transcript scoped to the current project (`src/transcript.rs:74-100`);
- when no transcript exists, `--continue` allocates a fresh path and otherwise behaves as a new
  session;
- corrupt JSONL lines are skipped with a stderr warning rather than failing the whole load
  (`src/transcript.rs:135-169`);
- query recording persists a message before adding it to in-memory history
  (`src/query.rs:715-724`).

`bingo share [SESSION]` can resolve a named fragment for export, but the main query command cannot
resume that selected session. There is also no headless rename or delete command. Therefore
repeated `--print --continue` processes are unsafe for multiple GUI conversations: “most recent”
can change due to another conversation/process, and same-second path collisions can mix histories.

## 9. Implications for the Electron boundary

The audited CLI can support only a limited proof-of-concept chat safely:

- one child per turn;
- `--print --no-team`;
- raw incremental text from stdout;
- final structured runtime error from stderr;
- no visible tools;
- no robust permission dialog;
- no exact multi-conversation resume;
- no headless rename/delete;
- provider selection only through shared settings.

These are contract facts, not implementation recommendations. They do not satisfy PRD
`AC-F2-3` (every tool visible) or `AC-F3-4` (resume a selected session), and they cannot satisfy
`AC-F3-5` rename/delete without another owner for transcript mutations. PRD `AC-F3-5` requires
removing a transcript while `AC-F3-6` says the GUI only reads transcript storage; that ownership
contradiction must be resolved in the upstream API/architecture. The current transport also cannot
provide the intended approval UX.

## 10. Gap and proposed minimal bingo-side contract

### Worktree constraint

Do not modify `/Users/yexrob/Episodes/Projects/bingo` directly. The user approved an upstream
extension only in a new bingo worktree under `.bingo/worktrees/`, with branch and directory names
matching. Implementation begins only after main creates/assigns that worktree.

### Compatibility requirement

Add an explicit opt-in structured mode such as `--json-events`. With the flag absent, byte-for-byte
behavior of existing `--print` stdout/stderr and exit statuses must remain unchanged. Structured
mode should emit UTF-8 **NDJSON on stdout**, one complete JSON object per line, flush after each
object, and reserve stderr for diagnostics that are not protocol events. Do not mix raw assistant
text with JSON on stdout.

Schema should be versioned from the first event and use stable discriminators. Outbound events
(the bingo child writes these to stdout):

```json
{"v":1,"type":"session","sessionId":"bingo-gui-1786295815","transcriptPath":"/absolute/path.jsonl","provider":"default","model":"claude-sonnet-5","permissionMode":"default"}
{"v":1,"type":"turn_start","turnId":"<opaque>"}
{"v":1,"type":"text_delta","turnId":"<opaque>","text":"Hel"}
{"v":1,"type":"thinking_delta","turnId":"<opaque>","text":"…"}
{"v":1,"type":"tool_start","turnId":"<opaque>","toolCallId":"call_…","name":"Bash"}
{"v":1,"type":"tool_ready","turnId":"<opaque>","toolCallId":"call_…","name":"Bash","summary":"printf …","standalone":false}
{"v":1,"type":"tool_done","turnId":"<opaque>","toolCallId":"call_…","name":"Bash","summary":"printf …","status":"done","durationMs":12}
{"v":1,"type":"round_end","turnId":"<opaque>"}
{"v":1,"type":"warning","turnId":"<opaque>","msg":"…"}
{"v":1,"type":"permission_request","requestId":"<opaque>","turnId":"<opaque>","tool":"Bash","reason":"Bash needs permission","options":["allow","deny"]}
{"v":1,"type":"question_request","requestId":"<opaque>","turnId":"<opaque>","title":"…","question":"…","options":[{"label":"A","description":null}],"freeText":true}
{"v":1,"type":"error","turnId":"<opaque>","code":"OFFLINE","msg":"…","level":"full","context":"long_turn","fatal":true}
{"v":1,"type":"turn_end","turnId":"<opaque>","status":"completed"}
```

Inbound commands (the Electron main process writes these as NDJSON to child stdin):

```json
{"v":1,"type":"start","requestId":"<opaque>","cwd":"/absolute/project","sessionId":null,"provider":"default","model":"claude-sonnet-5","permissionMode":"default"}
{"v":1,"type":"prompt","requestId":"<opaque>","turnId":"<opaque>","text":"Hello"}
{"v":1,"type":"permission_response","requestId":"<request from permission_request>","decision":"allow | deny"}
{"v":1,"type":"question_response","requestId":"<request from question_request>","answer":{"kind":"option","index":0}}
{"v":1,"type":"question_response","requestId":"<request from question_request>","answer":{"kind":"text","text":"Other answer"}}
{"v":1,"type":"cancel","requestId":"<opaque>","turnId":"<active turn>"}
{"v":1,"type":"rename_session","requestId":"<opaque>","sessionId":"<opaque>","name":"new name"}
{"v":1,"type":"delete_session","requestId":"<opaque>","sessionId":"<opaque>"}
```

Protocol invariants required before implementation:

1. Exactly one `session` acknowledges an accepted `start`; every accepted `prompt` has exactly one
   `turn_start` and one terminal `turn_end`. `turn_end.status` is one of
   `completed | interrupted | error`.
2. `toolCallId` is available in `ContentBlock::ToolUse`, but current `ToolCallDone` omits it
   (`src/query.rs:225-236`). Carry the ID through completion so parallel/repeated tools correlate.
   `tool_done.status` must be `done | error | denied | interrupted`; current `is_error` cannot
   distinguish every source outcome, and interrupted placeholders are currently reported with
   `is_error: false` (`src/query.rs:942-959`).
3. The UI requirement needs a short input summary, not raw tool payloads. The default events above
   deliberately omit full input/output/diff because those may contain credentials, authorization
   headers, file contents, or other secrets. If a later detail event is added, bingo must redact it
   before IPC, cap it, mark truncation, and the GUI must never log/persist it or expose it to the
   renderer except through a sanitized allowlisted projection.
4. Canonical human-readable error/warning field name is `msg`, matching the existing
   `[error] code=... msg=...` and `UiEvent::Error`. Emit the structured `error` before
   `turn_end(status="error")`, then preserve process exit `1` for fatal process errors. clap may
   retain exit `2` outside the protocol when parsing fails before `start`.
5. Each `permission_request`/`question_request` has one unique outstanding `requestId`. Accept only
   the first matching response while that request is live; reject duplicate, unknown, late, or
   wrong-kind responses with a nonfatal protocol error. Cancellation, stdin EOF, or parent
   disconnect resolves outstanding requests as deny/cancel and terminates the active turn; no
   request may wait forever. Architecture owns the concrete timeout policy.
6. `cancel` is idempotent for the active `turnId`; a stale/unknown turn ID receives a nonfatal
   rejection and cannot affect a newer turn. The current headless call passes no cancel receiver
   (`src/main.rs:409-410`), so the adapter must connect this command to the existing watch-based
   cancellation path rather than relying only on process kill.
7. Session metadata uses an exact opaque `sessionId`. `start.sessionId` resumes exactly that
   session; null creates a collision-safe ID (not second-resolution-only). Validate ownership and
   traversal inside bingo. Rename/delete commands let bingo remain the single transcript writer
   and resolve the PRD `AC-F3-5`/`AC-F3-6` conflict.
8. Only one turn is active per session in v1. A second `prompt` while busy receives a nonfatal
   protocol rejection. Read stdin line-by-line for the process lifetime; EOF means parent
   disconnect, not end-of-prompt.
9. Every line must be a JSON object with supported `v`, bounded size, known command `type`, and
   required fields. Invalid JSON/shape/unsupported version receives a structured nonfatal protocol
   error when recoverable; unsupported major `v` prevents session start. The GUI ignores unknown
   outbound event fields and, for a supported major version, may log/ignore unknown event types
   only in the Electron main process without crashing the renderer.
10. stdout contains protocol lines only and flushes each line. stderr never carries required state.
    On child exit or broken pipe, the GUI marks any nonterminal turn as crashed/interrupted and
    rejects all pending request promises exactly once.

### Mapping to existing core events

The proposal deliberately follows existing renderer-agnostic `UiEvent` / `UiHooks` concepts:

| Proposed event | Existing source |
|---|---|
| `text_delta`, `thinking_delta`, `tool_start` | `StreamEvent` handled by `src/ui.rs:178-195` |
| `tool_ready` | `UiHooks.on_tool_ready`, `src/ui.rs:196-202` |
| `tool_done` | `UiHooks.on_tool_done`, `src/ui.rs:203-211` |
| `round_end`, `warning` | `src/ui.rs:213-217` |
| permission/question request | `PermissionRequest` and `DialogAction`, `src/ui.rs:24-65`, `150-165`, `219-244` |
| structured error dimensions | `UiEvent::Error`, `src/ui.rs:136-147` |
| session metadata | runtime model/provider/transcript in `src/query.rs:144-190` |

This should be an adapter over the existing core contract, not a second agent loop.

## 11. Reproduction notes

Representative isolation pattern:

```sh
BIN=/Users/yexrob/Episodes/Projects/bingo/target/release/bingo
ROOT=$(mktemp -d /tmp/bingo-cli-facts.XXXXXX)
mkdir -p "$ROOT/home" "$ROOT/xdg" "$ROOT/work"
(
  cd "$ROOT/work"
  env -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY -u ANTHROPIC_BASE_URL \
    HOME="$ROOT/home" XDG_CONFIG_HOME="$ROOT/xdg" \
    "$BIN" --print --no-team hello
) >"$ROOT/stdout" 2>"$ROOT/stderr"
printf 'exit=%s\n' "$?"
```

A successful streaming observation used the real configured endpoint while supplying a temporary
HOME and the existing XDG settings directory; no secret value was printed or copied. Timed reads
used Python `selectors` and `os.read` against separate stdout/stderr pipes.

## 12. Primary source index

- CLI flags, process branches, model/provider restore, top-level errors:
  `/Users/yexrob/Episodes/Projects/bingo/src/main.rs`
- Headless stream hooks, stdin prompts, query loop, persistence:
  `/Users/yexrob/Episodes/Projects/bingo/src/query.rs`
- Stable error mapping and message sanitation:
  `/Users/yexrob/Episodes/Projects/bingo/src/error.rs`
- Client error-code map:
  `/Users/yexrob/Episodes/Projects/bingo/src/api/contract.rs`
- Settings schema/layering:
  `/Users/yexrob/Episodes/Projects/bingo/src/settings.rs`
- Provider/key/default behavior:
  `/Users/yexrob/Episodes/Projects/bingo/src/api/client.rs`
- Transcript format/location/resume behavior:
  `/Users/yexrob/Episodes/Projects/bingo/src/transcript.rs`
- Renderer-agnostic UI event contract:
  `/Users/yexrob/Episodes/Projects/bingo/src/ui.rs`
- Message/content JSON schema and built-in model:
  `/Users/yexrob/Episodes/Projects/bingo/src/api/types.rs`
