# Can a headless Claude session ask permission, and what does its stream look like?
Spike 2026-11-20, `claude` 2.1.330 (Windows), scratch dir only. Kolux's engine was read first
(`docs/chat-engine.md`, `src-tauri/src/chat_engine/{mod,events}.rs`), so shapes are named against
its Rust types.

**The one limit.** The signed-in account is out of weekly quota: every real model turn returned a
synthetic assistant message plus `result` with `is_error:true`, no tool calls. To still exercise the
real binary's *permission machinery*, the CLI was pointed at a local fake Messages API
(`ANTHROPIC_BASE_URL` = 127.0.0.1, throwaway key, per-process env only, no settings touched). Model
text is fake; tool dispatch, permission decisions, the control channel and the event stream are real
2.1.330 paths. Permission is decided after a `tool_use` exists, so a fake model does not distort it.
The user's hooks and skills loaded; none of their names or content appear here.

## 1. Baseline shape (OBSERVED)
`claude -p "reply with the single word hi" --output-format stream-json --verbose` gave six lines, in
order: `system/hook_started`, `system/hook_response` (`exit_code`, `outcome`), `system/init`,
`rate_limit_event` (quota; a type the engine does not know), `assistant`, `result`.

Text arrives as **whole assistant messages, not token deltas**: one `assistant` line carries
`message.content` as an array of complete blocks (here one `text`). No `stream_event` lines appear
without `--include-partial-messages`.

With `--input-format stream-json`, `system/init` arrives **after the first user message**, not at
start (OBSERVED: user line at 3038 ms, init at 3602 ms). That answers the open question in
`docs/chat-engine.md`: init does not come first. So a chat started and left idle has no `session_id`,
and its idle-sleep resume starts fresh.

## 2. What comes back when a tool needs approval (OBSERVED)
Prompt: create `notes.txt` containing `hello`. A real `Write` tool_use was produced under four
configurations: `--permission-mode manual`; `manual` plus a successful `initialize` control request;
`default` plus `--permission-prompts host`; and `auto`. In **none** did a question arrive.

```
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_fake_1","name":"Write", ...}]}, ...}
{"type":"system","subtype":"permission_denied","tool_name":"Write","tool_use_id":"toolu_fake_1",
 "message":"Claude requested permissions to write to <path>, but you haven't granted it yet.", ...}
{"type":"user","message":{"content":[{"type":"tool_result","content":"Claude requested permissions ...",
 "is_error":true,"tool_use_id":"toolu_fake_1"}]}, ...}
{"type":"assistant","message":{"content":[{"type":"text","text":"<model's next line>"}]}, ...}
{"type":"result","subtype":"success","is_error":false, ... "permission_denials":[]}
```

So: **no control request, no permission request object; a `system/permission_denied` plus an error
`tool_result`, and the turn carries on.** No file was written. The gap before the denial varied
(0.4 s, 1.6 s, 5.5 s) with nothing emitted during it. The denial line had **no** `decision_reason`
or `decision_reason_type`; the UI gets `message` only, and the engine reading both as `None` is fine.

## 3. The ask channel exists in this build, but a bare client never gets it
OBSERVED (static, from the protocol schema embedded in `claude.exe` 2.1.330):

```
subtype: "can_use_tool" | tool_name: string | mcp_server?: string | input: object
permission_suggestions?: array | blocked_path?: string
decision_reason?: string (human-readable, for the host's dialog; may carry ANSI)
decision_reason_type?: string (why auto-mode escalated)
decision_reason_code?: closed set, e.g. "outside_reads_blocked", "org_ask_ceiling"
```
The answer the host sends back:

```
{ "behavior": "allow", updatedInput?: object, updatedPermissions?: array,
  toolUseID?: string, decisionClassification?: string }
{ "behavior": "deny",  message: string, interrupt?: bool, toolUseID?: string }
```

The binary's own prose: *"An ask reaches the host as a can_use_tool control request; where no host
can answer, and in dontAsk or plan mode, it is refused."* Envelope, the same one Kolux already uses
for interrupt (OBSERVED live), and the reply (OBSERVED live, twice):

```json
{"type":"control_request","request_id":"kolux-1","request":{ ...request object above... }}
{"type":"control_response","response":{"subtype":"success","request_id":"kolux-1","response":{ ... }}}
```

INFERRED: the SDK-style `initialize` request is what makes the CLI treat a client as a host, plus a
capability it must recognise. A bare `{"subtype":"initialize"}` **did** succeed (the CLI answered
with its full command/skill list) but **did not** enable asking. What exactly it wants is UNKNOWN;
plausible candidates are a capability flag inside `initialize` or a host transport flag, neither
found before the time budget ran out.

## 4. Event order for a tool call in one turn (OBSERVED, ms from spawn)
```
 3048 stdin  user message
 3567 stdout system/init            <- after the user message
 3718 stdout assistant (tool_use Write)
 5358 stdout system/permission_denied
 5372 stdout user (tool_result, is_error true)
 5452 stdout assistant (text)
 6154 stdout result
```
No `thinking` block appeared for these prompts; thinking is a block inside `assistant`, never a line.

## 5. The `result` event (OBSERVED)
```
type, subtype, is_error, result, errors?, session_id, uuid, num_turns, duration_ms, duration_api_ms,
total_cost_usd, usage, modelUsage, permission_denials, stop_reason, terminal_reason, ttft_ms,
queued_turn_count, result_index, subagent_stats, safety_stops, fast_mode_state, api_error*,
credential_expires_at
```
Two traps. **`subtype:"success"` with `is_error:true`** is how the quota failure arrived, with
`terminal_reason:"api_error"`, `total_cost_usd:0`, empty `usage` and the human text in `result`: the
engine reads `is_error`, but UI branching on `subtype` alone would call a failed turn a success. And
**`permission_denials` is not always an array** (came back `{}`); `list()` already tolerates it.
`usage` carries `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`, `service_tier`, `server_tool_use`; passing `usage` and `modelUsage` raw is
right.

## 6. `claude --help`, verbatim (OBSERVED)
```
--input-format <format>       "text" (default) or "stream-json" (realtime streaming input)
                              (only works with --print) (choices: "text", "stream-json")
--output-format <format>      "text" (default), "json" (single result), or "stream-json"
                              (realtime streaming) (only works with --print)
--permission-mode <mode>      Permission mode for the session (choices: "acceptEdits", "auto",
                              "bypassPermissions", "manual", "dontAsk", "plan")
--permission-prompts <target> Who answers permission prompts with --print: "host" (the SDK host
                              or --permission-prompt-tool) or "none" (nobody: anything that would
                              prompt is denied automatically; the mode still decides the rest)
                              (choices: "host", "none", default: "host")
```
From the mode descriptions in the binary: `auto` means *"use a model classifier to approve/deny
permission prompts"*, and `manual` is normalised (passed `manual`, init reported `default`).
## 7. The interrupt channel (OBSERVED)
Kolux's exact line, sent with no turn running:
```
stdin {"type":"control_request","request_id":"kolux-stop-1","request":{"subtype":"interrupt"}}
+9 ms {"type":"control_response","response":{"subtype":"success","request_id":"kolux-stop-1",
       "response":{"still_queued":[]}}}
```
Answered in 9 ms; the process stayed alive waiting, and **no `result` was emitted** because no turn
was running. `still_queued` is v2.1.268+ (`interrupt_receipt_v1`, which this build lists). The
5-second wait-for-`result` fallback is right for the mid-turn case, and a `control_response` must not
be read as the turn ending.

## Answer to the question
**Partly.** The channel to ask exists and is fully specified (`can_use_tool`, with an allow/deny
answer carrying `updatedInput`), and the transport Kolux already speaks carries it. But in this build
a client that only writes user messages and reads stdout **is never asked**: the CLI denies and tells
the model. Today: no question, only a refusal. A real question needs a host handshake this spike did
not pin down (UNKNOWN), and `--permission-mode auto` routes decisions through a model classifier
before anything could reach a host anyway.

## What Kolux must change
1. **Do not promise a permission prompt.** A blocked tool surfaces as `system/permission_denied` +
   an error `tool_result` + the turn continuing. Render that as "Claude needed permission for X and
   it was refused", not a pending question. `PermissionDenied` exists; give it a UI and use `message`
   as fallback text.
2. **Treat `result.subtype == "success"` + `is_error: true` as a failure** and show `result` (quota,
   auth and API errors arrive this way). Surface `terminal_reason` too.
3. **Only then decide whether to invest in real answering** - a separate spike: find the `initialize`
   capability that unlocks `can_use_tool`, then answer with `{behavior:"allow", updatedInput}` or
   `{behavior:"deny", message}`.
4. **Stop assuming `session_id` exists after `chat_start`.** `system/init` arrives only after the
   first user message, so a chat that starts and idles has no id to resume; start fresh, or start the
   idle clock at the first `result`.
5. **Keep the interrupt fallback; never read `control_response` as turn end** (verified: no turn
   running gives a control_response only, 9 ms, no `result`).
6. **Optional:** add `rate_limit_event` and the two hook subtypes to the known types so they stop
   arriving as `raw` (harmless, just noisy).
