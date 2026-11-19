# Chat engine (Claude, stream-json)

Written 2026-11-19. Code: `src-tauri/src/chat_engine/` (`mod.rs` process and commands,
`events.rs` the typed reading of each line, `tests.rs`, `stub.js`, `fixtures/`).

Each chat is one hidden `claude` process. The page talks to it through four Tauri commands and
hears back on one Tauri event. (The close command is `chat_end`: the terminal-pane chat still
registers `chat_close` until it retires; rename then if wanted.) Any number of chats can run at once; they are keyed by the page's
own chat id.

Sources (read 2026-11-19):

- Headless mode: https://code.claude.com/docs/en/headless
- CLI reference: https://code.claude.com/docs/en/cli-reference
- Agent SDK (TypeScript) message types: https://code.claude.com/docs/en/agent-sdk/typescript
- Streaming input: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode

## The process

```
claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode auto [--model <m>] [--resume <session id>]
```

- `claude` is found on PATH (PATHEXT included, so a `claude.cmd` shim works; a shim runs through
  the system `cmd.exe /d /c`). Started with the no-console-window helper, stdin/stdout/stderr piped.
- Never `--bare`: the user's hooks, skills, commands, subagents, plugins, MCP servers, auto memory
  and CLAUDE.md all load. `CLAUDE_CODE_SIMPLE` (the variable `--bare` sets) is removed from the
  child's environment. A unit test checks the argument list; a process test checks both.
- Environment: inherited, plus the caller's `extraEnv`, plus the sign-in variables from the same
  place terminal panes get them (key mode, managed account folder). A managed account plus a
  sign-in override in `extraEnv` is refused, as for a terminal pane.
- A model name may hold only letters, digits and `-._:[]/@`; a session id only letters, digits
  and `-` (both can reach `cmd.exe`). Anything else is refused before a process starts.

## Commands

| Command | Arguments (as the page passes them) | Returns |
|---|---|---|
| `chat_start` | `chatId: string, cwd: string, model: string \| null, resumeSessionId: string \| null, extraEnv: [string, string][]` | nothing; error text on failure |
| `chat_send` | `chatId: string, text: string, images: { media_type: string, base64: string }[]` (`mediaType` also accepted) | nothing |
| `chat_stop` | `chatId: string` | `"interrupt"`, `"ended"`, or `null` when no turn was running |
| `chat_end` | `chatId: string` | nothing (closing an unknown chat does nothing) |

- `chat_start` on a chat id that is already open closes the old one first. It starts the process
  at once; `cwd` must be an existing folder.
- `chat_send` writes one user message. A chat with no process (asleep, crashed, or stopped by
  ending the process) starts again first, with `--resume <session id>` when one is known.
  A send while a turn runs is written straight away; the agent queues it.
- On quit, the app calls `chat_engine::close_all(app)`, which ends every chat's process.

Messages written to stdin:

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}}]},"parent_tool_use_id":null}
{"type":"control_request","request_id":"kolux-stop-1","request":{"subtype":"interrupt"}}
```

## The event

One Tauri event name: **`chat-event`**. Payload: `chatId` plus the event's fields, with `kind`
naming the event. Field names are camelCase. One example each:

```json
{"chatId":"c1","kind":"started","pid":4242,"resumed":null}
```
```json
{"chatId":"c1","kind":"init","sessionId":"5f0e…","uuid":"…","cwd":"/work/demo","model":"claude-sonnet-demo","permissionMode":"auto","claudeCodeVersion":"2.9.0","apiKeySource":"none","outputStyle":"default","tools":["Read"],"slashCommands":["compact"],"terminalSlashCommands":[],"skills":["tidy","demo-plugin:review"],"agents":["general-purpose"],"betas":[],"capabilities":["interrupt_receipt_v1"],"plugins":[{"name":"demo-plugin","path":"/plugins/demo-plugin"}],"pluginErrors":[],"mcpServers":[{"name":"notes","status":"connected","source":null},{"name":"tracker","status":"failed","source":null}],"mcpServerErrors":[{"name":"tracker","kind":"connect_failed","message":"…"}],"fastModeState":null,"effort":null,"raw":{"…":"the whole line"}}
```
```json
{"chatId":"c1","kind":"assistant","sessionId":"5f0e…","parentToolUseId":null,"messageId":"msg_02","model":"claude-sonnet-demo","error":null,"blocks":[{"type":"text","text":"Reading the readme first."},{"type":"thinking","text":"…"},{"type":"toolUse","id":"toolu_read1","name":"Read","input":{"file_path":"/work/demo/README.md"},"step":{"kind":"tool","tool":{"call":"toolu_read1","name":"Read","group":"read","preview":"README.md","done":false,"failed":false,"background":false}}},{"type":"other","raw":{}}]}
```
```json
{"chatId":"c1","kind":"user","parentToolUseId":"toolu_task1","text":[],"toolResults":[{"toolUseId":"toolu_sub_bash","output":"3","isError":false}]}
```
```json
{"chatId":"c1","kind":"compactBoundary","trigger":"auto","preTokens":167000}
```
```json
{"chatId":"c1","kind":"permissionDenied","toolName":"Bash","toolUseId":"toolu_rm1","decisionReasonType":"rule","decisionReason":"Bash(rm:*) is denied","message":"Permission to use Bash was denied."}
```
```json
{"chatId":"c1","kind":"apiRetry","attempt":2,"maxRetries":10,"retryDelayMs":500,"errorStatus":529,"error":"overloaded"}
```
```json
{"chatId":"c1","kind":"result","subtype":"success","isError":false,"result":"The project has 3 files.","errors":[],"sessionId":"5f0e…","numTurns":4,"durationMs":5200,"durationApiMs":4100,"totalCostUsd":0.0123,"usage":{"input_tokens":70,"output_tokens":31},"modelUsage":{},"stopReason":"end_turn","permissionDenials":[{"toolName":"Bash","toolUseId":"toolu_rm1","toolInput":{"command":"rm -rf build"}}]}
```
```json
{"chatId":"c1","kind":"stderr","line":"some warning"}
```
```json
{"chatId":"c1","kind":"exit","code":0,"reason":"sleep"}
```
```json
{"chatId":"c1","kind":"stopped","how":"interrupt"}
```
```json
{"chatId":"c1","kind":"raw","line":"{\"type\":\"system\",\"subtype\":\"hook_started\"}","json":{"type":"system","subtype":"hook_started"}}
```

Notes on the shapes:

- `parentToolUseId` is `null` for the main conversation. A subagent's rows name the Task call that
  started them (the docs say a skill forked by a prompt uses a `forked-command-` prefix).
- `step` is the chat view's own reading of a tool call (`chat_tools::claude_step`): `kind: "tool"`
  with the tool row, or `kind: "plan"` with Markdown text for TodoWrite / ExitPlanMode.
- A tool result's `output` is its text (a string, or the text parts joined by new lines), capped
  at `chat_tools::MAX_OUTPUT` (20,000 bytes) with `chat_tools::cap`.
- `result.subtype` is `success` or an error subtype (`error_max_turns`, `error_during_execution`,
  `error_max_budget_usd`, `error_max_structured_output_retries`); error results carry `errors`.
- `exit.reason`: `closed` (chat_end or quit), `sleep` (idle sleep), `stopped` (chat_stop had to
  end the process), `ended` (it ended by itself with code 0), `crashed` (any other end).
- Anything this reader does not know (hook events, `plugin_install`, control responses, stream
  events, a line that is not JSON) arrives as `raw`, whole. Nothing is dropped.

## Stop

`chat_stop` uses the documented **interrupt** control request first:

1. It writes `{"type":"control_request","request_id":…,"request":{"subtype":"interrupt"}}`.
   The docs say an interrupt ends the turn with an `error_during_execution` result and keeps the
   session open, so the process stays and the chat goes on.
2. If no `result` arrives within 5 seconds (`STOP_GRACE`; tests shorten it), the process tree is
   ended (`exit` with reason `stopped`). The session id is kept; the next `chat_send` starts the
   chat again with `--resume`.
3. Either way a `stopped` event says which happened (`interrupt` or `ended`), and the command
   returns the same word. With no turn running it does nothing and returns `null`.

`CLAUDE_CODE_RESUME_INTERRUPTED_TURN` is not set, so a resume after a stop does not pick the
stopped turn back up.

## Idle sleep

After 10 minutes (`IDLE_SLEEP`, injectable through `Config.idle` for tests) with a process running
and no turn running, the process is ended (`exit` with reason `sleep`). The chat stays open and keeps
its session id; the next `chat_send` starts it with `--resume <session id>`. A chat that never got a
session id (no init arrived) starts fresh instead. The idle clock restarts at every send and every
`result`.

## Empty-init alarm

`chat_engine::events::empty_init_alarm(&Init, &Expected) -> bool` (pure). `Expected` holds the names of
the skills, plugins and connectors Kolux found for the user. It is true when the init came back
with no skills, no plugins and no MCP servers at all while at least one of the three is expected:
the sign of a start without the user's setup.

## Not known

- **The exact interrupt request field.** The docs name an `interrupt` control request (with an
  optional `cancel_queued`) inside the `control_request` envelope, but do not print the request
  body. Kolux sends `"request":{"subtype":"interrupt"}`. If a real `claude` ignores it, the
  5-second fallback still stops the turn (by ending the process), so stop always works.
- **The `control_response` shape.** Not printed in the docs. Control responses arrive as `raw`
  events; the engine waits for the turn's `result`, not for a control response.
- **Whether `system/init` comes before the first user message** in stream-json input mode. The
  engine does not depend on it: the session id is read from `init` or any `result`.
- **What `fast_mode_state` and `effort` hold.** Passed through as raw JSON.
- **The exit code after an interrupt-free end by stdin closing.** Read as reported.

## Tests

`cargo test chat_engine`. Parsing tests use hand-written fixtures (`fixtures/*.jsonl`) shaped on
the documented types, never captured from a real config folder. Process tests run `stub.js` with
node (on PATH here and in CI), never the real `claude`, each in its own temp folder with a scratch
`CLAUDE_CONFIG_DIR`: start / send / stop / close, the stop fallback and resume, sleep and resume,
and 20 chats at once.
