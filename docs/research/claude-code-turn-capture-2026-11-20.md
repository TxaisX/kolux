# Claude Code turn capture — 2026-11-20

How the Claude Code CLI presents a working session, captured so Kolux can render those
terminals as calm chat conversations.

Method: static read of the shipped native binary plus one trivial `-p --output-format
stream-json` probe. No interactive TUI session was recorded, so anything about on-screen
glyphs and spacing is INFERRED and should be confirmed against a live terminal first.

## Evidence

| id | what | how |
|---|---|---|
| E1 | claude 2.1.330, PE x86_64, sha256 `fa797c1b…01caa` (369.8 MB, Bun single-file bundle, JS kept as text) | REA `open_binary` |
| E2 | 6-line stream-json probe for `-p "say hi"` | one CLI run, read-only |
| E3 | spinner verb array, ~180 alphabetical entries, plus a `spinnerVerbs` setting with `mode: "replace" \| "append"` | byte scan |
| E4 | status words: `% context used`, `% until auto-compact`, `% remaining`, `Context low (`, `/compact to free up space`, `still thinking`, `Waiting for API response`, `next try in`, `check your network` | byte scan |
| E5 | mode chrome: `accept edits on`, `plan mode on`, `auto mode on` | byte scan |
| E6 | interrupt hints: ``· next try in ${L} · attempt ${t.attempt} · esc to interrupt``, `esc to interrupt and send` | byte scan |
| E7 | permission prompt copy (question, options, feedback hints) | byte scan |
| E8 | interruption / abandonment markers | byte scan |
| E9 | key bindings table (`app:interrupt`, `app:toggleTranscript`, …) | byte scan |
| E10 | tool grouping copy (`N calls: open the group for the rest`, `ctrl+o for the rest`) | byte scan |
| E11 | `<tool_use_error>…</tool_use_error>` wrapper, transcript marker kinds, `tool_use_id` / `parent_tool_use_id` | byte scan |
| E12 | SSE event names and delta types | byte scan |
| E13 | `--ax-screen-reader` = "flat text, no decorative borders or animations" | `claude --help` |

REA's `search_strings` answered `provider_unavailable`, so string evidence comes from direct
byte scans of E1 rather than REA evidence ids. Every quoted string below was read out of
that binary or out of the E2 probe.

## 1. Turn anatomy

A turn is one user line, then any number of assistant segments, each carrying text, a thinking
block, and tool calls with results, then a closing line.
OBSERVED (E8, E10, E13, E2): the transcript is a flat list of typed rows. A marker kind exists
for each thing the terminal can draw: user text, assistant text, `thinking`, tool calls, tool
results, `tool_use_error`, `sandbox_violations`, `persisted-output`, `system-reminder`,
attachments. So "what a turn looks like" is really "which row kinds exist and how each
collapses".

| row | default | expands via |
|---|---|---|
| assistant text | full | — |
| thinking | collapsed to a label | `ctrl+o` |
| tool call + result | one line each, grouped | `ctrl+o` |
| long result, diagnostic counts | truncated to a summary line | `ctrl+o` |
| groups of older calls | collapsed to a count | open the group |

OBSERVED (E10): `N calls: open the group for the rest` and `ctrl+o for the rest`. A burst of
tool calls does not print N full blocks; it prints the newest and a count for the rest. This is
the most important behaviour to copy — it is why the terminal reads calm.
OBSERVED (E4): `Found {n} new diagnostic{s} in {n} {files} (ctrl+o to expand)`. Counts collapse
to one line with a stated expansion key.
UNKNOWN: the exact bullet glyph, indent width and colour of each row. Not present as UTF-8 or
as `\uXXXX` in the bundle, so it is generated at runtime or lives in bytecode. INFERRED: a
filled dot for assistant rows, a corner glyph for results. Do not hard-code a glyph from this
doc.

## 2. Tool-call presentation

INFERRED (from E10, E11 and the stream schema): a tool row is one line of `<verb> <target>` —
the target being the tool's own short summary: a path for file tools, the command for shell,
the pattern for search. The result sits indented beneath as one line, truncated, with the full
body behind `ctrl+o`.
OBSERVED (E11): failure is not a different layout, it is a different tag. A failed result is
wrapped as `<tool_use_error>Error: …</tool_use_error>` and recorded under a distinct marker
kind (`tool_use_error`) rather than as ordinary output. That is what lets the terminal colour
it and lets a chat UI mark the row failed. Other states with their own row: `sandbox_violations`,
and `persisted-output` (result too large, written to a file).
UNKNOWN: the per-tool elapsed wording, and whether the spinner noun is the tool name or a
gerund. No template string was recovered.

## 3. Status chrome

Working line. OBSERVED (E3): the verb comes from a fixed array of ~180 alphabetical gerunds —
`Accomplishing`, `Baking`, `Clauding`, `Cogitating`, `Combobulating`, `Reticulating`,
`Smooshing`, `Zigzagging`. Users replace or extend it with a `spinnerVerbs` setting; `replace`
discards the built-ins, `append` adds to them. The verb is decorative and unbounded — Kolux
must not depend on any particular word.
OBSERVED (E4, E6): the status line is assembled from short labelled fragments, not one fixed
sentence: `still thinking`, `Waiting for API response`, `retry in`, `next try in`, `check your
network`, and always `esc to interrupt`. The retry variant adds attempt and countdown:
`· next try in {t} · attempt {n} · esc to interrupt`.
Context and spend. OBSERVED (E4): context is reported as percentages — `% context used`,
`% until auto-compact`, `% remaining` — plus a low-context nudge `Context low (% remaining)` and
the escape hatch `/compact to free up space`. No raw token counter was found in the footer.
UNKNOWN: how cost is displayed in the terminal. `/cost` exists as a command but no cost format
string was recovered. The stream carries exact money per turn (§6), so Kolux can show real
numbers where the CLI shows none.
Modes and keys. OBSERVED (E5, E9): a persistent footer badge — `accept edits on`,
`plan mode on`, `auto mode on` — cycled with `shift+tab`. Bindings: `ctrl+c` `app:interrupt`,
`ctrl+d` `app:exit`, `ctrl+t` `app:toggleTodos`, `ctrl+o` `app:toggleTranscript`, `ctrl+shift+b`
`app:toggleBrief`, `ctrl+r` `history:search`.
OBSERVED (E13): `--ax-screen-reader` renders "flat text, no decorative borders or animations" —
the product treats decoration as a layer over a plain-text transcript.

## 4. Diffs, edits and permissions

OBSERVED (E7): the permission prompt is one question plus a short option list. Default question
is `Do you want to proceed?`. Options are shaped as `Yes, allow reading from {path} from this
project`, `Yes, and always allow access to {cmd} from this project`, `Yes, and don't ask again
for {cmd} commands in {dir}`, `Yes, and don't ask again for any {tool} command`, `No, and tell
Claude what to do differently`. The feedback box that follows is labelled `tell Claude what to
do next` (accept) or `tell Claude what to do differently` (reject). Plan feedback adds
`shift+tab to approve with this feedback`.
OBSERVED (E7): the prompt degrades honestly. If the terminal is too small it says `This terminal
is too short. Make it taller to choose Yes, or choose No.` rather than hiding options. If the
target list cannot be shown it refuses to summarise: `This list of files is too long to show in
full, or has characters that can't be shown as written, so it can't be approved.` Refusing to
approve beats approving blind — copy this.
Staged edits. OBSERVED: proposals are described as held, not applied: `Accept and apply this
change`, `Discard this change`, and a stale guard `This file changed after this was staged … so
it cannot be applied.`
UNKNOWN: the inline diff body — whether unused lines print dimmed with `+`/`-` gutters, and the
added/removed count wording. The pair `additions` / `removals` sits in the string pool beside
other UI label pairs, consistent with counts shown as "N additions, N removals", but INFERRED.

## 5. Streaming and stopped turns

Order. OBSERVED (E2): the first thing on stdout is a `system/init` object carrying the tool
list, modes, version and paths — not model output. A `rate_limit_event` can arrive before the
first token. Then assistant content. No thinking line appeared because thinking was off.
Partial text. OBSERVED (E12): the wire underneath is standard SSE — `message_start`,
`content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`,
`message_stop`, `ping`. Delta types: `text_delta`, `input_json_delta`, `thinking_delta`,
`signature_delta`, `citations_delta`, `compaction_delta`. INFERRED: the terminal paints text as
deltas arrive, and a tool call appears as soon as its `input_json_delta` completes, before any
result exists — which is why the working spinner is visible on that row. Thinking, OBSERVED, is
a real row kind with its own field, revealed with `ctrl+o`; INFERRED, it renders as one collapsed
line while streaming, never a live wall of text.

Stopped turns. OBSERVED (E8): stopping is an inserted marker row, not an error, and the marker
is specific about why:

- `[Request interrupted by user]` / `[Request interrupted by user for tool use]`
- `[Tool call did not complete: the turn was ended to deliver the message that follows. Nothing refused it; re-run it if still needed.]`
- `[Tool call did not complete: the plugin that made it cancelled it. Nothing refused it.]`
- `A safety monitor blocked this turn, so this tool call was cancelled. If it had already started, some of its effects may have happened.`
- `[Request interrupted: the session ended before this agent finished. Nobody asked it to stop.]`
- `[This turn ended before it finished.]` / `[Tool call interrupted: the session ended before this call's result was recorded…]`

A cut-off turn must say *which* kind of cut-off it was, and must warn when a tool may have
half-run.

## 6. stream-json shapes

OBSERVED (E2). One JSON object per line. Six line types in a trivial turn:

```
system   subtype: init | hook_started | hook_response
rate_limit_event
assistant
user                      (tool results ride here; not hit in this probe)
result   subtype: success | error
```

`system/init` — session frame, read once: `type, subtype, cwd, session_id, model, permissionMode,
output_style, view_mode, claude_code_version, apiKeySource, fast_mode_state,
per_turn_effort_active, tools[], agents[], skills[], slash_commands[], mcp_servers[], plugins[],
capabilities[], memory_paths, additional_directories, messaging_socket_path`. Strip before
showing: `cwd`, `original_cwd`, `additional_directories`, `memory_paths`,
`messaging_socket_path`, `session_id`.

`assistant` — the only row type Kolux turns into chat text:

```
type: "assistant"
message:
  id, role, model, type: "message", stop_reason, stop_sequence
  content: [                                # array of blocks, API shape
    { type: "text",     text }
    { type: "thinking", thinking }
    { type: "tool_use", id, name, input }   # id links to the later tool_result
  ]
  usage: input_tokens, output_tokens, cache_creation_input_tokens,
    cache_read_input_tokens, cache_creation{ephemeral_1h_input_tokens,
    ephemeral_5m_input_tokens}, output_tokens_details{thinking_tokens},
    server_tool_use{web_search_requests, web_fetch_requests}, service_tier, speed,
    inference_geo, iterations[]
session_id, uuid, timestamp
```

`user` — where a tool result returns. OBSERVED (E11): the link field is `tool_use_id`, and
subagent rows carry `parent_tool_use_id`. INFERRED block: `{ type: "tool_result", tool_use_id,
content, is_error }`. UNKNOWN whether the transport row also sets `is_error` or relies on the
`<tool_use_error>` tag alone.

`result` — one per turn, the closing line:

```
type: "result", subtype: "success" | "error"
duration_ms, duration_api_ms, num_turns, is_error, result
total_cost_usd               # exact money for the turn
usage                        # same counters, plus totals
stop_reason, terminal_reason, queued_turn_count, result_index
permission_denials[]         # what the user refused this turn
subagent_stats{spawned, completed, failed, killed{parent,user,system}, refused{…}}
safety_stops, fast_mode_state, api_error{,_type,_status,_origin}
```

`rate_limit_event` — `rate_limit_info{status, resetsAt, rateLimitType, overageStatus,
isUsingOverage, unifiedWindows.seven_day{utilization, resetsAt, status}}`.
Thinking, subagent text and hooks only appear if you ask: `--include-partial-messages` adds the
SSE deltas, `--forward-subagent-text` emits subagent blocks with `parent_tool_use_id` set,
`--include-hook-events` adds hook rows.

## What to copy into Kolux

1. Rows, not prose. One turn is a typed list: user text, assistant text, thinking, tool call,
   tool result, marker. Type each row, then style it.
2. Collapse by default, expand on demand. `ctrl+o` is the whole information architecture. Copy
   the rule, not the key.
3. "Newest one plus a count" for tool bursts. `N calls: open the group for the rest` removes
   most of the noise in a long agentic turn.
4. A working line built from fragments, with a decorative verb, honest sub-states (`still
   thinking`, `Waiting for API response`, `retry in 3`), and an always-visible interrupt hint.
5. Percentage for context, exact money from `total_cost_usd`. The CLI shows `% until
   auto-compact`; the stream hands you real numbers. Show both.
6. Failure is a tag, not a layout: render `<tool_use_error>` / `is_error` as a marked row that
   keeps the same shape as a success row.
7. Specific stop markers. Take the interruption strings' *meanings* — user stopped, tool
   half-ran, session died, safety monitor — and warn when effects may have happened.
8. Permission prompts that refuse rather than guess when the target cannot be shown in full.
9. Read `system/init` once for tools, modes and version; read `result` once for cost, denials
   and duration. Everything between is row data.

## What to leave behind

1. The glyphs, borders and colour codes. The CLI itself ships a borderless flat-text mode
   (`--ax-screen-reader`) because the decoration is optional. Kolux should own its own visual
   language and take only the structure.
2. The 180 spinner verbs. They are a joke, they are user-replaceable, and copying them makes
   Kolux look like a clone. One quiet indeterminate state is calmer.
3. Terminal-shaped compromises: fixed-width truncation, `ctrl+o`, "make the terminal taller",
   spinner-as-progress. A chat surface has room the terminal does not.
4. `cwd`, `session_id`, `memory_paths`, `messaging_socket_path` from `init`. Never render them
   as content.
5. Internal marker types (`sandbox_violations`, `ccr_*`, `tengu_*`). Map the handful with user
   meaning; drop the telemetry vocabulary.

## Gaps

- No PTY capture, so glyphs, spacing, indent width and colour are unverified.
- Could not see the live diff body or the added/removed count wording.
- Could not confirm per-tool elapsed wording, nor the main working-line template (only the
  retry and low-priority variants were recovered).
- `user` / `tool_result` block layout inferred from field names, not from a captured line.
- Cost display in the terminal: not found.
