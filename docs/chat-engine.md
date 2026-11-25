# Chat engine (OpenCode, and Claude stream-json)

Written 2026-11-19; OpenCode added 2026-11-24. Code: `src-tauri/src/chat_engine/` (`mod.rs` process
and commands, `opencode.rs` the OpenCode server, its chats and the translation of its events,
`events.rs` the typed reading of each line, `tests.rs`, `opencode_tests.rs`, `stub.js`, `fixtures/`).

Two agents run a chat. `opencode` (2026-11-24) is what the chat page starts: every model it offers,
Claude's included, runs through OpenCode, and each chat is one OpenCode session on a server the
engine shares between all chats (see "OpenCode chats"). `claude` is Claude Code's own stream-json
process, one hidden process per chat, described under "The process". The page hears both the same
way: the commands, the event name and the payload shapes below are the same for the two.

Each `claude` chat is one hidden `claude` process. The page talks to it through four Tauri commands and
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

- This section is the `claude` agent only. `chat_start` takes `claude` or `opencode` and refuses
  any other id.
- The program is found on PATH by its agent id (PATHEXT included, so a `claude.cmd` shim works; a
  shim runs through the system `cmd.exe /d /c`). Started with the no-console-window helper,
  stdin/stdout/stderr piped.
- Never `--bare`: the user's hooks, skills, commands, subagents, plugins, MCP servers, auto memory
  and CLAUDE.md all load. `CLAUDE_CODE_SIMPLE` (the variable `--bare` sets) is removed from the
  child's environment. A unit test checks the argument list; a process test checks both.
- Environment: inherited, plus the caller's `extraEnv`, plus the sign-in variables from the same
  place terminal panes get them (key mode, managed account folder). A managed account plus a
  sign-in override in `extraEnv` is refused, as for a terminal pane.
- A model name may hold only letters, digits and `-._:[]/@`; a session id only letters, digits
  and `-` (both can reach `cmd.exe`). Anything else is refused before a process starts.

## OpenCode chats

Added 2026-11-24. Measured against `opencode` 2.4.1.

**Transport.** One `opencode serve --hostname 127.0.0.1 --port 0` for the whole app, started the
first time a chat, the model list or a session list needs it, with no console window. The system
picks the port and the server names it in its first line (`server listening on http://127.0.0.1:<port>`).
Kolux makes a fresh password for each start (32 bytes from the system's secure random source, as
hex), passes it as `OPENCODE_PASSWORD` (an `OPENCODE_SERVER_PASSWORD` or `OPENCODE_SERVER_USERNAME`
in the environment is removed), keeps it in memory only and sends it as HTTP Basic auth (user
`opencode`) on every call. The programs OpenCode starts inherit the variable; it opens only this
loopback server. An npm `opencode.cmd` shim is not run through `cmd.exe`: the `opencode.exe` it names
is started directly, the same way a terminal pane resolves a shim. Events
arrive on one long `GET /api/event` stream (server-sent events) and are routed to every chat that has
the session open (one session may be open in two chats). Each chat is one OpenCode session.

- No request is sent to a fresh server before its event stream is open (its first event has
  arrived); a caller waits up to 10 seconds for it, and a second caller waits for a start under way
  instead of making another. The start itself runs with no lock held.
- A stream that closes is opened again. One that fails to open (a refused status, no connection) is
  tried again after a wait that doubles each time (from 300 ms, at most 10 s); after 8 failures in a
  row the server is ended and each chat gets a `stderr` line saying why, then `exit {reason: "crashed"}`.
  A stream that opens but closes within 5 seconds having carried nothing but `server.*` events
  (the greeting, a heartbeat) counts as a failure too. A stream that carried any other event (of any
  session, or a permission question), or stayed open 5 seconds, is never counted, however often it
  drops, so a server that works is never ended for its stream.
- A turn the page was told is over before OpenCode said so (a stop that got no answer in time, a
  lost stream) stays over: that run's late events are dropped until OpenCode says the run ended or
  the next run starts, and that run's own end adds no second `result`.
- **Waiting messages: one `result` per message, from OpenCode's own word only.** OpenCode keeps a
  sent message in the session's inbox until a run takes it up (`session.inbox.delivered`) or it is
  cancelled (`session.inbox.cancelled`). Nothing else removes it: a run that succeeds, fails or is
  interrupted leaves the inbox alone, and a message left waiting after a stop is taken up by the
  next run, together with the next message. So the engine keeps a waiting message until one of
  those two events, and never answers one on a guess while the stream is live:
  - taken up: `user` (the echo), and one `result` when the run that took it up ends;
  - cancelled: one `result {subtype: "cancelled"}`;
  - a run that ends with a message still waiting ends only the messages it took up.
  A message is known as waiting from the answer to its `prompt` call (the inbox item's id), so it
  does not depend on `session.inbox.enqueued` being heard. Only a user's message counts: OpenCode's
  own inbox items (a compaction, a synthetic note) add no `result`.
- **Only a chat's own messages are its own.** One session can be open in two chats, and both hear
  every event of it. A message belongs to the chat whose `prompt` call OpenCode answered with its
  inbox id, and to no other. For a message another chat sent, a chat only mirrors: the `user` echo
  and the reply are shown, it gets no `result` for the message and no `cancelled`, the message does
  not make it busy, and its Stop and its close leave that run and that waiting message alone. Two
  fallbacks, both from OpenCode's answer to the chat's own call: a `prompt` call that got no answer
  makes the next message heard queued within 5 seconds with the same text that chat's own (a message
  with another text is not taken, and does not use the claim up); a `prompt` call OpenCode accepted
  without naming an inbox id makes the chat count every message of the session as its own from then
  on (it cannot tell them apart). A message OpenCode settles before the answer to its `prompt` call
  is applied (it cancels it, or a run takes it up and ends) gets its one `result` when that answer
  names it: `cancelled`, or the plain outcome of that run. That holds for a message never heard
  queued too: a delivery that names an unknown message while one of the chat's `prompt` calls is on
  its way is kept until that call's answer says whose it is. If the answer comes while the run still
  goes on, the run is the chat's own from there and its end gives the message's `result`.
- **A run is known from its start or from its own events.** A chat opened in the middle of a run
  never hears `session.execution.started`. Any step, text, reasoning or tool event of the run, or
  the delivery of a waiting message, tells it a run is going on. Whose run it is does not change by
  that: it is the chat's own only once it took up a message of the chat. So a message the chat sends
  behind a run it opened into waits like any other, and the chat's Stop and close leave that run
  alone. Not covered: a chat that has heard nothing at all of a run going on cannot know of it, and
  with a message of its own waiting its Stop or close posts the interrupt.
- **A run's end gives a chat as many `result`s as its page counted for that run.** The page counts
  1 for each send, takes 1 off for each `result`, and counts 1 for a reply (`assistant`) that comes
  while it counts 0. So a chat that counts only its own messages gets, when a run ends:
  - one `result` for each message of its own the run took up;
  - plus one when its page drew the run as a turn: a reply was shown while the chat had nothing of
    its own on its way (a `prompt` call not answered yet), waiting, or taken up by the run. That is
    a run another chat started and this one mirrors. A message the chat sends after that, steered
    into the same run, adds its own `result`: two in all;
  - when both are zero, one `result`, which closes what was mirrored, unless a message of the
    chat's own is on its way or waiting. Then the run ends there with no `result`: the page counts
    1 for that message, and would take the run's `result` for it. The message gets its one `result`
    from the run that takes it up.
  The first `result` carries the run's outcome; any further one is a plain `success`. A run that
  took up messages of both chats gives each chat one `result` per message of its own. A chat opened
  in the middle of a run never hears it start; once it has shown a reply of the run, the run's end
  gives it its `result` like any other. A Stop that leaves the run going (it is not this chat's)
  sets the page's count to 0, so the next reply shown draws the turn afresh. A message counts as on
  its way from the start of the chat's send, before the server is woken and a waiting model pick is
  posted, as the page counts it from there; a send that ends before its `prompt` call (the server
  did not start, the pick was not applied) takes it back, as the page does on the send's error. A
  lost stream ends a turn the page drew of a mirrored run too (`connection_lost`), so the page is
  not left counting a run whose end may be missed.
- **After a lost stream** the engine asks OpenCode what happened in the gap instead of guessing. For
  each chat with a cut run or a waiting message it reads `GET /api/session/active` (the sessions
  running now), `GET /api/session/{id}/inbox` (the messages still waiting) and, for each waiting
  message no longer in the inbox, `GET /api/session/{id}/message/{messageID}` (a delivered message
  keeps its inbox id). Then, per message:
  - still in the inbox: it stays waiting, with no `result`;
  - a saved message, session still running: the run is followed from here as that message's turn
    (`user` now, its `result` when the run ends);
  - a saved message, session not running: `user` and exactly one `result` (an error one when the
    session's last message is an idle marker that says the run failed or was interrupted);
  - neither in the inbox nor a saved message: one `result {subtype: "cancelled"}`.
  A session that is not running has no cut run left to wait for, whatever its last message is (a
  run ended by a shutdown writes no idle marker). A read that gets no answer settles nothing:
  unknown is never taken as idle. A message heard on the stream meanwhile is left to the stream.
  Two cases where the reads and the stream disagree in time:
  - a run's end is heard after OpenCode was asked and before its answer is applied: "still running"
    is old news, so the message gets its one `result` now instead of a turn with no end to come;
  - the reads were ahead of the stream, and the stream then replays the run of a message already
    given its `result`: that run adds nothing (its events are dropped until its end).
  The same questions are asked in two more cases, on the same rules: when a server went away with
  a run cut or a message waiting, the next server is asked as soon as its stream opens; and when a
  session commits a revert (`session.revert.committed`), which removes waiting messages with no
  `session.inbox.cancelled` for them.
  An answer for a chat that closed meanwhile is not sent, and nothing of it follows the chat's
  `exit`.
- **Nothing follows a chat's `exit`.** Every event a chat sends after it opened (a stream event's,
  the answer about a gap, a lost stream's `result`, the end of a Stop, a `stderr` line from Kolux,
  a server's end, and what a send or a model pick tells the page: `started` after a wake, `init`,
  the `stderr` line of a refused pick) is sent with the chat's lock held, after checking the chat is
  not closed. A close
  marks the chat closed under the same lock before it sends `exit`, so it waits for an event being
  sent and nothing comes after it. The sink (a Tauri `emit`) takes no lock of the engine, so
  holding the chat's lock over it cannot deadlock.
- Once the app is quitting, nothing starts the server again (a late send or model read is refused).

Why a shared server and not one `opencode run` per turn: sessions, the model list, delete and history
all come from the same API; a model or effort change between turns and an interrupt are single calls;
and a process per turn would pay OpenCode's setup (about 31k to 35k tokens of instructions, plus the
MCP servers starting) on every message and has no way to stop or queue a turn.

**Calls used.**

| Call | For |
|---|---|
| `POST /api/session` | a new chat (`directory` is the chat's `cwd`) |
| `GET /api/session/{id}` | a resumed chat: the session must exist |
| `POST /api/session/{id}/model` `{model: {id, providerID, variant?}}` | the model and the effort (`variant`), at open and whenever the page picks another pair |
| `POST /api/session/{id}/prompt` | one user message; the answer's `data.id` is its inbox id |
| `POST /api/session/{id}/interrupt` | Stop |
| `DELETE /api/session/{id}/inbox/{inboxID}` | Stop: cancel a message still waiting |
| `GET /api/session/active`, `GET /api/session/{id}/inbox`, `GET /api/session/{id}/message/{messageID}`, `GET /api/session/{id}/message?limit=1&order=desc` | after a lost stream: what ran, what still waits, how the last run ended |
| `GET /api/session?directory=` | `chat_sessions` |
| `DELETE /api/session/{id}` | `chat_session_delete` |
| `GET /api/session/{id}/message` | `chat_history` (the newest 200 messages) |
| `GET /api/model` | `chat_models` (it can answer with nothing in the server's first moments, so an empty answer is asked again and never cached; a list read from a server that ended meanwhile is not cached either) |

- A model id is `provider/model`, the string `opencode models` prints, for example
  `openrouter/deepseek/deepseek-v4.1-flash-1017`: the first segment is the `providerID`, the rest the `id`.
- The model and the effort can change between turns of one chat with no restart: `chat_start` on a
  chat id that is already open on the same folder and the same session only posts the new pair and
  emits a fresh `init`. With the server asleep the pick is kept and applied before the next message.
  If OpenCode refuses it then (a 4xx answer), the message is not sent, the chat gets a `stderr` line
  saying so, the pick is dropped and the chat shows the session's own model again (a fresh `init`),
  so the next message goes. The chat's model is only ever replaced by one OpenCode names: a session
  read that names none leaves the last model OpenCode took from this chat, and if the read fails
  nothing is changed and the pick stays waiting. A pick that got
  no answer at all, or a server error (5xx), stays waiting for the next send too. A new pick made
  while the server is up replaces a pick still waiting only once OpenCode has taken the new one; if
  that call fails, the older pick still waits. A resumed chat whose pick is refused still opens, on
  the session's own model, with a `stderr` line. A resumed chat whose pick got no answer or a
  server error opens too, with a `stderr` line saying it is still on its old model; the pick waits
  for the next send.
- Efforts are per model and come from the model list (`efforts`). Seen 2026-11-24: DeepSeek V4.1
  Flash `none, low, high, max`; Claude Opus 5.5 `low, medium, high, xhigh, max`; GPT-5.5 `none, low,
  medium, high, xhigh`; some models none.
- Permission questions (`permission.asked`) are answered `once` by the engine, so a chat acts with
  no prompt: the same rule as the `claude` agent's `auto` mode. Every question on this private
  server is answered, whatever its session (a subagent asks from a session of its own that no chat
  has open). `init.permissionMode` says `bypassPermissions`.
- Environment: one fixed set for every start, whichever chat or command wakes the server: the app's
  own, plus the sign-in variables, plus the Everyday folder's `GIT_CEILING_DIRECTORIES` rule. A
  pane's `extraEnv` is not carried into an OpenCode chat: the shared server cannot take variables
  per session.
- Pictures are not sent to an OpenCode chat: `chat_send` with `images` is refused for it.

**Event mapping.** The page gets the same `chat-event` payloads as for `claude`.

| OpenCode | `chat-event` |
|---|---|
| chat opened, or the server woken for it | `started {pid, resumed}` (the server's pid) |
| session created, resumed, or given another model or effort | `init {sessionId, cwd, model, permissionMode: "bypassPermissions", effort, raw}`; `sessionId` is OpenCode's session id |
| `session.inbox.enqueued` | remembered (a user's message only) |
| `session.inbox.delivered` | `user {text: [the message]}` for a remembered message; nothing for any other item |
| `session.inbox.cancelled` | `result {subtype: "cancelled", isError: true, errors: [why it was not run]}` for a remembered message; nothing otherwise |
| `session.inbox.delivery.changed` | nothing |
| `session.execution.started`, `session.step.started`, `session.text.started`, `session.reasoning.started`, `session.tool.input.started` | nothing |
| `session.text.delta`, `session.reasoning.delta` | `assistant` with every block of the message so far (`messageId` is OpenCode's assistant message id, `model` is `providerID/id`), at most one per 80 ms per message |
| `session.text.ended`, `session.reasoning.ended`, `session.tool.called` | `assistant`, always |
| `session.tool.success`, `session.tool.failed` | `user {toolResults: [{toolUseId, output, isError}]}` (output capped) |
| `session.step.ended` | `assistant` with `usage`; the cost is summed for the turn |
| `session.step.failed` | the error is remembered for the turn's `result` |
| `session.retry.scheduled` | `apiRetry` |
| `session.compaction.ended` | `compactBoundary {trigger}` |
| `session.execution.succeeded` | `result {subtype: "success", sessionId, numTurns, durationMs, totalCostUsd, usage, result}`, and one more success `result` for each further message delivered in that run. A message still waiting gets none: it stays waiting |
| `session.execution.interrupted` | `result {subtype: "error_during_execution", isError: true}`, and a plain success `result` for each further message delivered in that run. A message still waiting stays waiting (OpenCode keeps it) |
| `session.execution.failed` | `result {isError: true, subtype: the error's type or "failed", errors: [message]}`, and a plain success `result` for each further message delivered in that run. A message still waiting stays waiting (OpenCode keeps it) |
| `session.tool.input.delta`, `session.tool.input.ended`, `session.tool.progress`, `session.usage.updated` | dropped |
| any other session event | `raw {line: the event type, json}` |
| the event stream is lost during a turn | `result {isError: true, subtype: "connection_lost"}` |

- Tool names are mapped to the names the page already groups (`bash` to `Bash`, and so on), so a
  tool row reads the same in both agents.
- `handoff` is never emitted for an OpenCode chat: OpenCode compacts a long session itself.

**Stop.** `chat_stop` posts the interrupt and waits the stop grace for the turn to end:
`stopped {how: "interrupt"}` when it does, `stopped {how: "ended"}` when it does not. The shared
server is never ended for one chat's stop. A run the page was already told is over (a lost stream,
an earlier stop with no answer) is still interrupted. A Stop acts only on the chat's own messages
(see "Only a chat's own messages are its own"). The interrupt is posted when the run going on is
this chat's own (it took up a message of this chat), or when no run is known to be going on and a
message of this chat may be starting one with nothing heard of it yet: a message that waits, a
`prompt` call still on its way, or one that ended within the last 5 seconds without naming its
inbox item. With nothing running there is nothing to wait for, so that Stop answers
`stopped {how: "interrupt"}` as soon as OpenCode took the interrupt. A run known to be going on that
another pane started is never interrupted from here, whatever this chat has in the session: nothing,
a message waiting behind that run, or one still on its way. The run goes on and stays mirrored,
there is no wait and no cut turn, and the chat answers `stopped {how: "ended"}` at once. A chat
opened in the middle of that run knows it from the run's own events (see "A run is known from its
start or from its own events"). An OpenCode chat always answers `stopped` (and returns `"ended"` or
`"interrupt"`, never `null`), so the page never waits. A close posts its interrupt for the chat's
own run, or for a message of its own that waits while no run is known; a message still on its way
is no reason for it.

A Stop also takes back the chat's own messages still waiting, whoever's run is going on: each one is
cancelled with `DELETE /api/session/{id}/inbox/{inboxID}` (after the interrupt, when one is posted).
Another chat's waiting messages are not touched. A close does not take waiting messages back: they
stay in OpenCode's inbox. A message gets its `cancelled` result only when OpenCode
says so (`session.inbox.cancelled`), which can be after `stopped`. If OpenCode does not cancel one
(it was taken up first, or the call did not land), the message stays waiting and gets its `result`
from the run that takes it up, which OpenCode starts with the next message sent.

**Sleep and exit.** The server is ended after `IDLE_SLEEP` (10 minutes) with no event and no busy
chat, or after `BUSY_IDLE_SLEEP` (60 minutes) of silence while a turn looks busy; every open chat
then gets `exit {reason: "sleep"}` and stays open, and the next send, model list or session list
starts the server again. A server that ends by itself gives `exit {reason: "crashed"}` (or `"ended"`
on a clean code). `chat_end` gives that chat `exit {reason: "closed"}` and leaves the server for the
others. `chat_engine::close_all` ends the server on quit: each OpenCode chat gets `exit {reason:
"closed"}` with no interrupt sent, a start under way is not waited for (its server is ended when it
finishes), and the process is ended after every lock is let go. On Windows the server is put in a
kill-on-close job of its own right after it starts, before it reads its settings, so it and the
programs it starts (MCP servers, language servers) end with the job.

**Not known / limits.**

- Whether OpenCode can read a picture by path or as an attachment through this API: not tried.
- The largest `limit` the message list accepts: not measured; the newest 200 are read.
- If Kolux itself is killed, Windows closes the server's job and ends the server and what it
  started. A program started in the moment between the server's start and its job (a few
  microseconds; OpenCode starts nothing that early) would be outside it. On other systems the
  server has no job and may stay until it is ended by hand.
- `chat_session_delete` takes `cwd` for the page's sake and does not check the session belongs to that folder.

## Commands

| Command | Arguments (as the page passes them) | Returns |
|---|---|---|
| `chat_start` | `chatId: string, cwd: string, model: string \| null, effort: string \| null, resumeSessionId: string \| null, extraEnv: [string, string][], agent: string \| null` (`"claude"` when left out) | nothing; error text on failure |
| `chat_send` | `chatId: string, text: string, images: { media_type: string, base64: string }[]` (`mediaType` also accepted) | nothing |
| `chat_stop` | `chatId: string` | `"interrupt"`, `"ended"`, or `null` when no turn was running |
| `chat_end` | `chatId: string` | nothing (closing an unknown chat does nothing) |
| `chat_models` | none | `{ id, label, provider, efforts: string[] }[]`: the models OpenCode lists |
| `chat_sessions` | `cwd: string` | `{ id, title, updatedAt }[]` (`updatedAt` in ms): OpenCode's saved sessions of that folder, newest first |
| `chat_session_delete` | `cwd: string, session: string` | nothing; the session is deleted from OpenCode for good |
| `chat_history` | `agent: string, cwd: string, session: string, limit: number \| null` | what a kept conversation already said; for `opencode` it is read from the server, for the others from the agent's transcript file |

The page's side of the three OpenCode commands is `src/chat/opencode.ts` (`listChatModels`,
`listChatSessions`, `deleteChatSession`).

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
{"chatId":"c1","kind":"exit","pid":4242,"code":0,"reason":"sleep"}
```
```json
{"chatId":"c1","kind":"stopped","how":"interrupt"}
```
```json
{"chatId":"c1","kind":"handoff","tokens":171240,"at":170000}
```
```json
{"chatId":"c1","kind":"raw","line":"{\"type\":\"system\",\"subtype\":\"hook_started\"}","json":{"type":"system","subtype":"hook_started"}}
```

Notes on the shapes:

- `parentToolUseId` is `null` for the main conversation. A subagent's rows name the Task call that
  started them (the docs say a skill forked by a prompt uses a `forked-command-` prefix).
- `assistant.usage` is that message's own usage, kept for the handoff line: the turn's `result`
  sums every tool call of the turn, which is not how full the window is.
- `step` is the chat view's own reading of a tool call (`chat_tools::claude_step`): `kind: "tool"`
  with the tool row, or `kind: "plan"` with Markdown text for TodoWrite / ExitPlanMode.
- A tool result's `output` is its text (a string, or the text parts joined by new lines), capped
  at `chat_tools::MAX_OUTPUT` (20,000 bytes) with `chat_tools::cap`.
- `result.subtype` is `success` or an error subtype (`error_max_turns`, `error_during_execution`,
  `error_max_budget_usd`, `error_max_structured_output_retries`); error results carry `errors`.
- `exit.reason`: `closed` (chat_end or quit), `sleep` (idle sleep), `stopped` (chat_stop had to
  end the process), `handoff` (the context reached the handoff line, below), `ended` (it ended by
  itself with code 0), `crashed` (any other end).
- `exit.pid` is the ended process's own id, as its `started` event named it. The page ignores an
  exit whose pid is not the last one started: a late exit of a replaced process says nothing about
  the one running now.
- `handoff.tokens` is the reading that crossed, `handoff.at` the line it crossed; the `exit` that
  follows says `handoff` too.
- Anything this reader does not know (hook events, `plugin_install`, control responses, stream
  events, a line that is not JSON) arrives as `raw`, whole. Nothing is dropped.

## Handoff

A chat follows the same cap and handoff line as a terminal pane. `chat_start` puts the 200k cap on
the process (unless the switch is off or the environment already sets it), creates the folder's
handoff note in the chat's own folder (`<folder>/.kolux/handoffs/<folder name>.md`), and passes the line from
`handoffAtTokens` (170,000 by default, `0` off). For a chat in a worktree that is not the note a pane
in the same worktree keeps: a pane's note is written in the main project's `.kolux/handoffs/`.

When a turn's `result` arrives and the last main-conversation `assistant` message of that turn carried a
prompt size (`input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens`) at or past the line, the engine sets the session id to `None`, ends the
process and emits `handoff` then `exit` with reason `handoff`. Nothing is typed into the agent: the
turn is already over. The next `chat_send` starts a fresh process with no `--resume`, and a Claude
Code chat is started with the note as an appended system prompt (not when Claude Code runs through a
`.cmd` shim: the note is free text and `cmd.exe` would split or run it). A result with no usage is never
guessed at, so a turn that reports nothing leaves the chat running.

A message the user sends while a turn is still running is queued by the agent, so the engine counts
the messages it has written that have not had their `result` yet. A reading past the line while one is
still queued marks the handoff as due, and the process ends on the first `result` that leaves none
outstanding: the queued message is answered first, never lost. Only the reader of the process running
now counts: a late line from a process that was already ended is ignored for the reading and the
handoff.

An agent that cannot take the note on its command line (Claude Code through a `.cmd`
shim) gets it in its first message after a handoff instead: the note text goes first inside the JSON
user line on stdin, then what the user wrote. Only that one message carries it. A plain Claude Code
chat keeps the appended system prompt, which also covers its very first start.

## Stop

`chat_stop` uses the documented **interrupt** control request first:

1. It writes `{"type":"control_request","request_id":…,"request":{"subtype":"interrupt","cancel_queued":true}}`.
   The interrupt ends the turn with an `error_during_execution` result and keeps the session open,
   so the process stays and the chat goes on.
   Checked live on 2026-11-23 with Claude Code and Haiku. Message A ran a 30-second Bash loop, B
   ("say BEE") was sent 2 s later, then the interrupt.
   - Without `cancel_queued`, B still ran after the interrupt and got its own `result`, 2 results
     in all.
   - With `"cancel_queued": true`, B never ran, 1 result in all.
   - Both times the `control_response` reported `still_queued: []` (and `cancelled: []`), so those
     lists are not a reliable count.

   Kolux sends `cancel_queued`, so Stop stops everything the user had sent. The engine marks how
   many messages were outstanding at the Stop. The first `result` after it answers all of them. A
   message sent after the Stop is new: it runs, and the chat stays busy until its own result.
2. If no `result` arrives within 5 seconds (`STOP_GRACE`; tests shorten it), the process tree is
   ended (`exit` with reason `stopped`). The session id is kept; the next `chat_send` starts the
   chat again with `--resume`.
3. Either way a `stopped` event says which happened (`interrupt` or `ended`), and the command
   returns the same word. With no turn running it does nothing and returns `null`.

`CLAUDE_CODE_RESUME_INTERRUPTED_TURN` is not set, so a resume after a stop does not pick the
stopped turn back up.

## Idle sleep

After 10 minutes (`IDLE_SLEEP`, `Config.idle`) with a process running, no turn running and no line from
it, the process is ended (`exit` with reason `sleep`). While a turn runs, the limit is 60 minutes
(`BUSY_IDLE_SLEEP`, `Config.busy_idle`; tests shorten both). The longer limit protects a long silent
tool call, such as a cargo build. It still ends a process that only looks busy because a result never
came. The chat stays open and keeps its session id; the next `chat_send` starts it with
`--resume <session id>`. A chat that never got a session id (no init arrived) starts fresh instead.

The idle clock restarts at every send and at every line the running process writes, of any kind (a
late line from an ended process does not count).

A reply that arrives while nothing is outstanding is a turn the engine did not count, for example
one the agent started by itself. The chat is busy again until that turn's result. The page does the
same with its own count of unanswered sends.

**Known limit: the folded queue.** At a tool boundary, Claude Code can fold a queued message into the
running turn, and then that message gets no `result` of its own. The engine then counts one message
as outstanding that never gets an answer. The chat looks busy (working line, Stop) until the
60-minute busy sleep ends the process, or until the user presses Stop. No settle timer is used for
this.

**Known limit: a Stop between turns.** When the chat only looks busy and no turn is running (the
folded queue above), the interrupt gets no `result`. Stop then waits the 5-second grace and ends the
process (`stopped` with `ended`); the next send resumes the session.

## Empty-init alarm

`chat_engine::events::empty_init_alarm(&Init, &Expected) -> bool` (pure). `Expected` holds the names of
the skills, plugins and connectors Kolux found for the user. It is true when the init came back
with no skills, no plugins and no MCP servers at all while at least one of the three is expected:
the sign of a start without the user's setup.

## Not known

- **The interrupt request in other versions.** The shape above was checked live on 2026-11-23 (see
  Stop). If a later `claude` ignores it, the 5-second fallback still stops the turn by ending the
  process, so stop always works.
- **The `control_response` shape.** Not printed in the docs. Control responses arrive as `raw`
  events; the engine waits for the turn's `result`, not for a control response.
- **Whether `system/init` comes before the first user message** in stream-json input mode. The
  engine does not depend on it: the session id is read from `init` or any `result`.
- **What `fast_mode_state` and `effort` hold.** Passed through as raw JSON.
- **The exit code after an interrupt-free end by stdin closing.** Read as reported.

## Tests

OpenCode: `opencode_tests.rs` feeds the translator hand-written events and checks the payloads, the
server-sent-event framing, the model and session rows and the history rows, with no server. One
ignored test (`live_a_chat_streams_a_reply_and_resumes`) runs a real turn, an effort change and a
resume against the installed `opencode`; it spends a few cents and is run by hand:
`cargo test --manifest-path src-tauri/Cargo.toml --lib opencode_tests::live -- --ignored --nocapture`.

`cargo test chat_engine`. Parsing tests use hand-written fixtures (`fixtures/*.jsonl`) shaped on
the documented types, never captured from a real config folder. Process tests run `stub.js` with
node (on PATH here and in CI), never the real `claude`, each in its own temp folder with a scratch
`CLAUDE_CONFIG_DIR`: start / send / stop / close, the stop fallback and resume, sleep and resume,
and 20 chats at once.
