# Chat panes: one pane as a calm chat (2026-11-20)

Bottom line: both halves are built and neither is wired. The stream-json engine runs in Rust with no
caller; the chat UI in `src/chat/` is complete but no screen mounts it. The first slice joins them for
one Claude pane. Then lifecycle, status, permissions, then artifacts.

## 1. What exists today

| Part | State | Where |
|---|---|---|
| Chat engine (stream-json) | Built, registered in `lib.rs`, no caller. `#![allow(dead_code)] // wired in the chat-app screens stage` | `src-tauri/src/chat_engine/` |
| Engine contract | Written, with fixtures | `docs/chat-engine.md` |
| Pane chat (transcript tail + keystrokes) | Built, unmounted. Reads `chat_read`, sends by typing into the PTY | `src/chat/`, `src-tauri/src/chat.rs` |
| Chat UI mount point | `AgentsChat` is exported through `lazy/pages.tsx`; no screen uses it | `src/chat/ChatView.tsx` |
| Pane body | Terminal only, with branches for check / seat / lost / asleep panes | `src/shell/window/Pane.tsx:144-156` |
| Status hooks | Per pane and terminal id, token in env | `src-tauri/src/hooks.rs:960` |
| Artifacts | Removed 2026-11-19; nothing reads the folder today | history only, see slice 5 |

Answers to Q1, in three parts:

1. **Does the engine already stream `-p --output-format stream-json`?** Yes. `claude -p --input-format
   stream-json --output-format stream-json --verbose --permission-mode auto [--model] [--resume]`, one
   hidden process per chat, four commands (`chat_start`, `chat_send`, `chat_stop`, `chat_end`) and one
   event (`chat-event`).
2. **Does it render assistant and tool blocks?** Half. Rust types every block and already folds a tool
   call into a `step` (`chat_tools::claude_step`); text, thinking, tool rows, tool results, denials,
   compaction and the turn `result` all leave Rust typed. No front-end listener exists: `grep chat-event
   src/` finds nothing.
3. **Is any of it reachable from a pane?** No. A pane runs its agent as a PTY (`terminal_spawn`), draws
   raw bytes in xterm, and its chat is the old transcript tail — which is also unmounted.

The old chat, for contrast: it polls `chat_read` every few seconds, rebuilds messages from the agent's
own JSONL on disk, and sends by typing text plus Enter into the PTY, held back while a hook says the
agent is showing a menu. It is the shape a chat pane must *not* copy, except its rendering.

## 2. The smallest change that makes one pane a chat

- **The message list already has an owner.** `src/chat/model.ts` (`ChatItem`, `Row`, `combine`),
  `src/chat/steps.ts` (`fold`) and `ChatView`'s `ViewRow` turn items into rows: messages, thought rows,
  step rows, diff cards, plans, dividers. Reuse them; do not write a second renderer.
- **The stream plugs in at one new reducer.** `src/chat/live/events.ts` maps a `chat-event` payload to
  `ChatItem[]` for one chat id. Rust already did the hard part (`step`, capped tool output, subagent
  `parentToolUseId`), so the reducer is mostly ids and timestamps.
- **The pane picks a body.** `Pane.tsx` already branches on pane shape before `<TerminalPane>`. Add one
  branch: `p.chat` renders a lazy `ChatPane`, else the terminal. Nothing else in the pane changes.
- **The terminal keeps doing everything it does now.** It is not wrapped or shrunk: a chat pane simply
  has no PTY. Every other pane keeps scrollback, xterm, links, find, input, usage.
- **Sending** is `chat_send` with the text; **Stop** is `chat_stop`; the composer, drafts, zoom, image
  attachments and link handling come from `MessageBox.tsx` / `ChatText.tsx` unchanged.
- **Loading**: the new pane must load through `lazy/pages.tsx`, as `AgentsChat` does, or the first load
  breaks the bundle ceiling (1,348,853 of 1,499,000 bytes today).

## 3. What breaks

| Area | Today | In a chat pane | Verdict |
|---|---|---|---|
| Resume after restart | Pane saves `session`; the terminal resumes with the agent's own args | Engine keeps the id in memory only; nothing saves it, and its messages live in React state | **Breaks.** Slice 2 saves the id in `SavedPane.session` and replays history from the transcript |
| Status hooks | Hook posts per pane + terminal; drives dot, sidebar row, needs-you, unread | A headless process gets no `KOLUX_HOOK_*` env, so no events | **Breaks,** but the engine's own events can feed the same states. Slice 3. Hook env for a chat is a later option (UNKNOWN, see below) |
| Permission prompts | Hook says "permission"; `PermissionCard` types `1`/`2` into the TUI | No TUI. `-p` cannot ask; it allows or denies and reports `permissionDenied` | **Breaks.** Biggest product gap. Slice 4, plus one spike. Fallback: run on auto and show denials as rows |
| Question cards (`AskUserQuestion`) | Card types option numbers into the TUI | No TUI. The question arrives as a tool call | **Breaks.** Read-only card, answer by a follow-up message |
| Plan review (Approve / Request changes) | `agent_answer` types keys | No TUI. `ExitPlanMode` arrives as a plan step | **Breaks.** Approve becomes a message; keep the plan sheet as a viewer |
| Scrollback, Ctrl-F, copy | xterm's own | None | **Changes.** Chat has `Load earlier` paging instead; terminal panes keep search |
| Worktree and launch | `workspace_create_fresh`, then `terminal_spawn` in that folder | Same folder, `chat_start` instead | **Keeps,** if `launchActions` marks the pane chat and skips the terminal spawn. Slice 2 |
| Close and restore | `closePane` kills the terminal; layout restores it | Must call `chat_end`, and quit must not hang (engine `close_all` exists) | **Works if wired.** Slice 2 |
| "Review changes" | Already removed in the slim-down | — | **Nothing to keep.** Plan review is the only review left |
| Drafts, images, zoom, links | Chat modules | Reused as-is | **Keeps** |
| Cost and context | Header readout from hook usage | Engine's `result` has cost, duration and usage | **Slice 3** |

## 4. Slices

Each slice ships and is testable alone. Sizes are working hours.

| # | Slice | What the user sees | Files | Test | Size |
|---|---|---|---|---|---|
| 1 | One pane is a chat | A Claude pane shows messages, tool rows and a reply as it comes; typing sends; Stop works | `src/chat/live/events.ts`, `src/chat/live/client.ts`, `src/chat/live/ChatPane.tsx` (new), `src/chat/ChatView.tsx` (export `ViewRow`), `src/shell/window/Pane.tsx`, `src/App.tsx` (`chat?: true`), `src/lazy/pages.tsx`, `src/launch/PlusMenu.tsx` | new `src/chat/live/events.test.ts`, `src/chat/live/client.test.ts`; `scripts/invoke-contract.test.mjs`, `scripts/bundle-budget.test.mjs` | 8 |
| 2 | It survives a restart | Reopen the app: the conversation is there and the session carries on | `src/chat/live/client.ts`, `src/terminal/layout.ts`, `src/terminal/layoutSave.ts`, `src/terminal/paneActions.ts` (close), `src/launch/launchActions.ts`, `src-tauri/src/chat.rs` (new `chat_transcript` by session id, reusing `session_files::locate` + `Parser`), `src-tauri/src/lib.rs` | `src/terminal/layout.test.ts`, `src/sessions/restoreOrder.test.ts`, new `src/chat/live/history.test.ts`, `cargo test chat` | 8 |
| 3 | It looks alive without hooks | Working line with elapsed time, a finished turn with duration and cost, the pane dot and sidebar row move | `src/chat/live/status.ts` (new), `src/chat/live/ChatPane.tsx`, `src/shell/window/Pane.tsx`, `src/terminal/headerUsage.ts`, `src/projects/rows.ts` | new `src/chat/live/status.test.ts`, `src/projects/rows.test.ts`, `src/terminal/headerUsage.test.ts` | 6 |
| 4 | Allow, Deny and the plan | A card for a refusal or an ask, with Allow and Deny; a plan card that opens the plan sheet | `src/chat/live/answers.ts` (new), `src/chat/PermissionCard.tsx`, `src/chat/QuestionCard.tsx`, `src/chat/live/client.ts`, `src/chat/live/ChatPane.tsx`; Rust only if the spike lands | new `src/chat/live/answers.test.ts`, `src/chat/ask.test.ts` (kept green) | 8 |
| 5 | Artifacts under the reply | Images the agent wrote into `artifacts/` show as previews under the turn; pages and video get a card with Open | see the artifacts slice below | new `src/chat/live/artifacts.test.ts`, Rust scan tests, `scripts/csp.test.mjs`, `scripts/privacy-audit.test.mjs` | 10 |

**Slice 1, in one sentence:** mount a lazy `ChatPane` for a pane marked `chat`, start it with
`chat_start`, and draw the live `chat-event` stream through the existing `fold` and `ViewRow`, leaving
every other pane a terminal. Entry point: a "New chat" row in the plus menu that makes one pane for
Claude; no default changes, no setting flipped.

**Slice 4 starts with a spike, not code.** Does headless `claude -p` send a `can_use_tool` control
request that a `control_response` on stdin can answer? Docs print neither body. If yes, the card is
real. If no, the card only shows denials and the honest text is "this agent runs without asking".

### Tests already here

- `src/chat/*.test.ts` — the rendering and behaviour rules: model, steps, send, box, page, reading,
  ask, composer, attachments, links, zoom. Slice 1 reuses all of it through `ViewRow` and `fold`.
- `src/terminal/paneActions.test.ts`, `remove.test.ts`, `closing.test.ts`, `layout.test.ts`,
  `layoutSave.test.ts`, `restoreAsk.test.ts` — the pane's own close, split and restore (slice 2).
- `src/status/*.test.ts`, `src/projects/rows.test.ts` — the dot, sidebar state and chips (slice 3).
- `src-tauri/src/chat_engine/tests.rs` (drives `stub.js`), `src-tauri/src/chat.rs` tests,
  `src-tauri/tests/cards_0*.rs` — both engines (slices 1, 2, 5).
- `scripts/invoke-contract.test.mjs`, `bundle-budget.test.mjs`, `csp.test.mjs`,
  `privacy-audit.test.mjs` — harness gates every slice must keep green.

## Artifacts slice (5)

Read the removal before building: `git show 6088d4ff` (Rust engine), `git show a6195136` (page). The
design that worked is in `src-tauri/src/artifacts.rs` at `6088d4ff^`; take the rules, not the library.

**What we keep from the old design.** The folder is `<pane cwd>/artifacts`, top level only. Kept kinds:
pages (`html`, `htm`), images (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `avif`, `bmp`, `ico`), video
(`mp4`, `webm`, `mov`, `m4v`; `mkv`, `avi` and `ogv` are left out because WebView2 cannot play them).
Caps: 200 files and 1 GB per folder. A file must resolve, by real path, inside the worktree; a link, a
junction and a network share are refused. A dotfile or a half-written file is skipped.

**What we drop.** The library copy, `library.json`, the `kolux-artifact://` scheme, CDN script
vendoring, removal bookmarks and the sandboxed iframe. Those existed so a page ran offline; a preview
of the real file does not need them, and they were 2,760 lines and a security surface.

**How the index is built.** One Rust command, `artifacts_scan(cwd)` → rows of
`{ path, name, kind, size, mtime }`, built fresh on each call from `read_dir` plus `metadata`. No
database: the folder is the index. Stamps are `(mtime, size)`, compared in the front end to know a file
changed. Called on mount, when a turn's `result` arrives, and every 3 s while the pane is visible
(`pollMs` in `src/chat/ux.ts`, `watchHidden` in `src/chat/reading.ts` already do the hidden pause).

**What the user sees.** Under the last finished turn, a strip of at most four items, newest first —
reusing today's "Files written" row (`FilesRow`, CHAT-028) for placement. An image shows a thumbnail
from a blob URL: `artifact_read(path, cap)` returns base64, capped at 10 MB, path checked again in Rust.
Video and pages show a card with the name, size and **Open** (system default program). Clicking a
thumbnail opens a large preview in the pane. Pages get no in-app preview in this slice.

**When a file changes.** The scan returns a new stamp for that path; the front end re-reads it, revokes
the old blob URL and swaps the thumbnail. A deleted file leaves the strip on the next scan. Edits land
within one poll (3 s) or at the end of a turn, whichever comes first.

**Why no `asset:` protocol.** The CSP has `img-src 'self' data: blob:` and no asset scope
(`src-tauri/tauri.conf.json:28`). Blob URLs need no CSP change and no build-time folder scope, which a
per-worktree preview cannot provide anyway.

## Permanently out of scope

Board, Tower (the agent list), Inbox and the code editor are gone for good. They appear in no slice,
no fallback and no risk list.

## What we deliberately do NOT build

- A durable chat journal (CHAT-034's database). History comes from Claude's own transcript.
- Codex or any non-Claude agent in a chat pane. The engine is Claude-only.
- "Show terminal" for the same session. A headless chat has no TUI, and two processes on one session is
  undefined. A chat pane is its own pane kind.
- Handing a live conversation between chat and terminal (CHAT-036).
- Remote, WSL and phone variants (CHAT-032, 043, 044 — dropped).
- In-app preview of generated HTML pages, and the old library's offline guarantee.
- Background-task bars, rewind, `/clear` history (CHAT-037, 038).
- Reworking the old transcript-tail chat. It stays dormant, or is deleted once the new pane is trusted.

## Unknowns

Marked UNKNOWN rather than guessed:

- **Whether a real `claude` works with this engine at all.** Its process tests run `stub.js`; the repo
  records no live run. Slice 1 must end with one real session on the Windows PC.
- **`--permission-mode auto` inside `-p`.** It is the value every pane uses today, but whether headless
  mode ever asks, and whether `can_use_tool` / `control_response` is supported, is not documented.
- **Hook env without a terminal id.** `pane_token(secret, pane, None)` and `status::report(pane,
  Option<u32>, ...)` both accept no terminal, but no caller uses that path. Whether the hook script and
  the endpoint file work for a headless chat needs a 2 h spike.
- **Streaming feel.** The engine passes `--verbose` and drops unknown lines into `raw`; token-by-token
  deltas, if any, arrive there unparsed. Until that is read, a reply appears when its message completes
  — correct, but not yet the Claude-app feel.
- **Resume while another process holds the session.** What Claude does when two processes resume one id
  is not documented here.
