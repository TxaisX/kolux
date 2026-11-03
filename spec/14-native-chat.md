# 14 · Native chat

Native chat lets a Claude or Codex session (and a few other agents) be read and driven as a
conversation instead of the raw terminal screen. It comes in two kinds. Terminal-backed chat leaves
the agent running in its terminal and rebuilds the conversation from the transcript the agent keeps
on disk; the user can flip between the two views at any time. Structured chat has Kolux run the
agent itself with no terminal behind it and keep its own durable record of the conversation. Both
sit behind experimental switches that start off, so every kept card is tier H. The Agents screen,
though, already shows supported sessions as terminal-backed chat with the switches off, which is why
many cards carry a default-build decision. The WSL, remote-host and phone variants are dropped
together with area 18.

Tier counts: P0 0 · P1 0 · P2 0 · H 41 · X 0 · D 3
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 07 Accounts, sign-in & keys · 10 Plan review & protected actions · 12 Editor & files · 13 Browser pane & computer use · 17 Settings, appearance & input · 18 Remote & hosts (dropped)

## Cards

### CHAT-030 · Chat inside split panes
Tier: H · Pushed: 1 · State at 0.15.0: hidden
User does: splits or closes panes around a chat.
User sees: the chat stays with its pane; if that pane closes, the chat moves to a neighbouring pane
  able to show it; split shortcuts behave as they do for terminals.
Rules: structured chat views stay loaded while hidden and simply become visible when picked.
Acceptance:
  - [ ] Close the chat pane in a two-pane split of the same session → the chat moves to the other
        pane.
  - [ ] Use the split-right shortcut while chat has focus → the pane splits just as a terminal
        would.
Compat: —
Decision: H: default skip
Source: D-14-030

### CHAT-042 · Structured chats appear as workspace tabs
Tier: H · Pushed: 1 · State at 0.15.0: hidden
User does: creates a worktree with a structured agent, or turns the feature off.
User sees: each structured chat appears as a tab in its workspace, even when empty; turning the
  feature off removes only those chat tabs.
Rules: a plain-folder workspace keeps its split and puts the chat next to the terminal.
Acceptance:
  - [ ] New worktree with structured Codex → a chat tab is there.
  - [ ] Turn the feature off → only the chat tabs go.
Compat: —
Decision: H: default skip
Source: D-14-042

### CHAT-002 · Which sessions can be shown as chat
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens an agent session on the Agents screen, or tries to flip a terminal tab to chat.
User sees: chat is offered only for sessions of supported agents; anything else stays a plain
  terminal.
Rules: supported agents are Claude, OpenClaude (read the same way as Claude), Codex, Grok and omp;
  shells, editors, browser tabs and every other agent are turned down; the agent actually detected
  running in the pane outranks an out-of-date tab title or the launch hint, and a title on its own
  never unlocks chat for an unsupported agent; a session whose transcript cannot be read on this
  computer stays a terminal; the Agents screen offers chat even with the experimental switch off;
  the Terminals screen needs the switch; a tab already showing chat can always go back to the
  terminal, even if support has since been lost; structured sessions have no terminal-or-chat
  toggle; a session that is still launching shows a chooser on the Agents screen rather than chat.
Acceptance:
  - [ ] Run Claude in a pane → chat is offered; run a plain shell → it is not.
  - [ ] Rename an unsupported agent's tab so it reads like Claude → chat is still not offered.
  - [ ] Switch off, open a Codex session on the Agents screen → it renders as chat.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-002

### CHAT-006 · Chat follows the agent's transcript live, even before the file exists
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens chat on a session that has just started or is mid-conversation.
User sees: a loading state, then the conversation so far, then each new turn as the agent records
  it; a fresh session never flashes an error while its transcript has not been written yet.
Rules: the first read takes everything recorded so far; after that only newly added lines are read;
  while the transcript is missing the view keeps loading and tries again after 1, 2, 4 and 8
  seconds, then every 10 seconds, and shows an error only after 60 seconds; if the file is rotated,
  renamed or recreated the view re-attaches to it, and periodic checks catch changes the file
  watcher missed; a transcript location reported by the agent's hooks is used before any folder
  search; an empty conversation shows an empty state; a session known to be working whose transcript
  is not yet flushed stays loading with Stop still available; a last line that is only partly
  written is held back until it is complete.
Acceptance:
  - [ ] Open chat on a session whose transcript appears 5 seconds later → loading, then messages,
        and no error at any point.
  - [ ] Delete and recreate the transcript → the chat keeps updating.
  - [ ] No transcript for 70 seconds → a readable error state.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-006

### CHAT-007 · Finding and reading each agent's transcript
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Claude, OpenClaude, Codex, Grok or omp, with their default home folders or custom
  ones.
User sees: chat shows the right conversation whichever account home folder the agent used.
Rules: for Claude, the folder named by Claude's own config-folder environment variable is tried
  first, then the default home, and OpenClaude follows the same layout; for Codex, the home folder
  of the account Kolux manages comes first, then Codex's own home environment variable; for Grok and
  omp, each agent's own home environment variable is used, and Grok's wrapper tags and start-up rows
  are removed while its reasoning summaries are kept; each agent's format reader drops system
  prompts and control characters and reunites pasted images with the message they belong to; turn
  start and end are taken from the transcript, so a turn that crashed does not look busy forever.
Acceptance:
  - [ ] Point Claude at a custom config folder and run it → chat shows that session.
  - [ ] A Grok transcript whose user text is wrapped in tags → chat shows only the user's own words.
  - [ ] Kill an agent in the middle of a turn → once the transcript is read again, that turn no
        longer shows as working.
Compat: Honours the home-folder environment variables that Claude, Codex, Grok and omp define
  themselves, and reads each agent's native transcript format (Claude's event-per-line log, Codex's
  session rollout, Grok's chat history, omp's session log).
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-007

### CHAT-010 · Each message once, in order, without system noise
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: reads the conversation.
User sees: user and agent turns in time order, a timestamp on hover and a copy button on every
  message; internal reminders and task notices are hidden; an interrupted turn shows a single status
  row.
Rules: messages from hooks, the transcript and the scraped terminal are combined, the transcript's
  version wins and repeats are dropped; order is by time, then by a stable message identity; a
  streaming preview sits after real content but before sends not yet confirmed; injected envelopes
  such as system reminders and task notices stay hidden, and a skill or slash-command envelope is
  shown as the short command the user typed; image markers inside text become an image turn with a
  thumbnail that opens at full size; copying a message gives a brief Copied confirmation, and
  timestamps follow the app's language.
  a Copy the clipboard refuses says "Copy failed" and goes back to Copy; the per-message button that
  scrolls the message to the top of the view is labelled Scroll to start.
Acceptance:
  - [ ] Agent output that also came in through a hook → shown once.
  - [ ] A transcript containing a system reminder block → the block is not visible.
  - [ ] Press Copy on one reply → the clipboard holds that reply only.
  - [ ] Copy a reply while the clipboard refuses it → the button says Copy failed, then Copy again.
        (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-010

### CHAT-011 · The reply streams in while it is being written
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: sends a message and watches.
User sees: the reply grows in place before the transcript has it, and is then swapped for the final
  turn with no flicker and no second copy.
Rules: the live preview appears only during an active turn, and only when it runs ahead of the
  transcript; previews marked as tool output, blank previews, and previews no longer than the last
  reply are not shown.
Acceptance:
  - [ ] Ask for a long answer → text appears before the turn ends; when it ends exactly one reply
        remains.
  - [ ] A preview that is only tool output → it never shows as reply text.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-011

### CHAT-012 · Reasoning, compaction, plans and provider notices
Tier: H · Pushed: 3 · State at 0.15.0: live
User does: reads a turn that included reasoning, a context compaction or a plan.
User sees: reasoning tucked behind a Thought button; a Context compacted divider; a plan shown as
  formatted text; provider notices with a Details section that expands.
Rules: reasoning starts folded; notice details are capped in length but never thrown away; these
  folded reasoning rows are the Thought rows of the Agents screen chat.
  the two buttons that fold or unfold every Thought row are labelled Expand thoughts and Collapse
  thoughts.
Acceptance:
  - [ ] A turn with reasoning → a folded Thought button; click it → the reasoning appears.
  - [ ] After a compaction → a divider row in the conversation.
  - [ ] A turn with reasoning → the buttons above the chat read Expand thoughts and Collapse
        thoughts. (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-012

### CHAT-013 · Tool calls fold into the agent's turn
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: watches the agent read files, run commands, search the web or call MCP tools.
User sees: a single live line naming the tool in use and what it is working on; when the turn
  settles, the calls collapse into a compact row with icons by kind that expands to show each call
  and its result.
Rules: each call is paired with its result as one step, and a call with no result yet stays in
  progress; icon kinds are read, edit, shell, MCP (with the server's name), web, and a generic one;
  the preview of a call is short: the file's name, the command itself, or the search term; shell
  calls show the command instead of the tool's name; failed calls look neutral rather than alarm
  red; only safe links inside results can be clicked; prose and tool steps from the same message
  stay apart.
  a web link in a tool result, a plan or a provider notice goes the way a link in a reply goes
  (CHAT-025: the browser choice and the Open links in Kolux setting), and a failure to open it is
  said under the box, instead of always opening the system browser.
Acceptance:
  - [ ] The agent runs three commands → one live line while they run, one folded row afterwards.
  - [ ] Expand the row → every command and its output is visible.
  - [ ] Click a web address inside a tool result → the same two-browser choice as for a link in a
        reply appears. (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-013

### CHAT-014 · File edits show as diff cards
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: looks at a turn in which the agent changed or created files.
User sees: a coloured diff for each file with line numbers, tagged as added, deleted, renamed or
  edited, with a button that copies the diff.
Rules: Claude's edit, write and multi-edit tools and the Codex patch tool all produce the same kind
  of card, and a patch touching several files gives one card per file; very long diffs are cut short
  with a note that some lines are hidden; the copied diff marks each line with a plus or minus at
  the start; an edit that was refused shows the agent's error in place of a diff, and notebook edits
  stay a plain tool row; text that looks like a diff is coloured only when it has hunk headers, and
  a row of dashes is a divider rather than a removed line.
  Copy diff reverts to its label after a moment, and says Copy failed when the clipboard refuses.
Acceptance:
  - [ ] A Codex patch touching two files → two cards.
  - [ ] A refused edit → the error text and no diff.
  - [ ] Copy a diff → every changed line starts with a plus or a minus.
  - [ ] Copy a diff while the clipboard refuses it → the button says Copy failed, then Copy diff
        again. (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-014

### CHAT-015 · Subagents appear as one roster row
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: watches an agent that starts subagents.
User sees: a row counting the subagents started, live while they work and turning into a summary of
  how many ran once they finish, with each child's state, elapsed time and token count; a failed
  child is pointed out.
Rules: child states are working, idle, completed, failed, stopped and unverifiable, and the worst
  state decides the row's overall verdict; children still marked running from an earlier app run
  settle as unverifiable instead of working forever.
Acceptance:
  - [ ] The agent starts two subagents → the row shows two working; when both finish → a summary
        that two ran.
  - [ ] Restart the app mid-run → those children show as unverifiable.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-015

### CHAT-016 · Responding, thinking and working indicators
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: sends a message and waits.
User sees: a responding indicator straight after sending, then a working line with elapsed time
  below the latest user message, then how long the turn took.
Rules: every elapsed timer runs off one shared clock, which pauses while the chat is hidden; a
  leftover working state is cleared by a completion or interruption marker, and once the user
  interrupts, working is no longer shown; Claude waiting on background work counts as monitoring,
  not as working in the foreground; a working row restored from an earlier run is not treated as
  live.
Acceptance:
  - [ ] Send → the indicator shows within one frame; when the reply is done → the indicator is gone
        and the duration is shown.
  - [ ] Press Stop → the working line goes away.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-016

### CHAT-017 · Chat message box
Tier: H · Pushed: 3 · State at 0.15.0: live
User does: types in the box at the foot of the chat and presses Enter.
User sees: a box that grows to about eight lines, sends on Enter, steps through earlier messages
  with the up and down arrows, and keeps an unsent draft for each pane.
Rules: Enter sends and Shift+Enter starts a new line; empty messages are ignored and an exact repeat
  is stored in history only once; Escape closes an open menu and does not interrupt the agent;
  typing anywhere in the chat pane sends the keys to the box, and Backspace or Delete moves focus
  there; Enter never cuts short or doubles text still being composed with an input method editor
  (IME); Select All and Paste from the app menu act on the box; drafts are kept per pane up to a
  size limit and survive a terminal reconnect; when the session has no live terminal, the
  placeholder tells the user to switch back to reconnect; the Agents screen relies on this box now
  that the terminal-grid message bar is gone.
  a note shown under the box clears itself after 10 seconds (the Stopping note clears when the turn
  ends instead); the focused box has a visible outline in every theme.
Acceptance:
  - [ ] Type 12 lines → the box stops growing at about 8 and scrolls.
  - [ ] Switch tabs and come back → the draft is still there.
  - [ ] Compose Japanese with an IME and press Enter to confirm a word → nothing is sent.
  - [ ] A note appears under the box → it is gone after 10 seconds. (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-017

### CHAT-020 · Sending from chat types into the agent's terminal
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: sends a message from chat to an agent that runs in a terminal.
User sees: the message shows at once as a pending bubble and becomes a normal message when the agent
  records it; a send that fails says it did not arrive and to look at the terminal.
Rules: the agent's input line is cleared, the text is pasted (as a bracketed paste when it spans
  several lines), and Enter follows after a short pause; quick successive sends to one terminal are
  queued in order; escape and control characters inside the text are made harmless; Codex slash
  commands that open a picker are typed as keys, while other slash commands and skills are pasted;
  pending bubbles still match the transcript when two quick sends were merged into one turn, and at
  most 8 are kept per pane; a slash command leaves a marker that it ran, and a local /clear hides
  the earlier messages.
Acceptance:
  - [ ] Send two messages within 100 ms → both arrive, in order, as separate turns.
  - [ ] Send text with several lines → it arrives whole as one prompt.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-020

### CHAT-022 · Answer an agent's question with a card
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: the agent asks a multiple-choice question; the user picks options or types an answer.
User sees: a card with the question, its options (one or several may be picked), a free-text answer,
  and for several questions a step count with Next, Skip and Submit.
Rules: answers reach Claude, OpenClaude and Codex as keystrokes that choose the option numbers; the
  card goes away once answered and is removed by /clear or an interrupt, and the same question sent
  again stays hidden; if live status does not carry the question, it is rebuilt from the transcript;
  while an answer is being typed into the agent the card shows Sending… with Cancel and locks the
  chosen answer; if the pane changes, sending becomes impossible, or a new question takes its place,
  the remaining keystrokes are dropped.
Acceptance:
  - [ ] The agent asks with three options and the user clicks the second → the agent receives option
        2 and the card closes.
  - [ ] A two-question ask → Step 1, Next, Step 2, Submit.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-022

### CHAT-027 · Chat sticks to the newest message
Tier: H · Pushed: 3 · State at 0.15.0: live-unverified
User does: scrolls up while the agent is still writing.
User sees: within about 48 px of the bottom the view follows new output; further up it holds still
  and a Jump to latest button appears.
Rules: a per-message action brings that message to the top of the view.
Acceptance:
  - [ ] Scroll up 500 px during output → the view does not move and the jump button shows; click it
        → back at the bottom.
  - [ ] Stay at the bottom while output arrives → the view keeps following it.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-027

### CHAT-033 · Structured chat sessions that Kolux runs itself
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: with all three chat switches on, starts a local Claude or Codex session.
User sees: a chat that Kolux drives directly, with no terminal behind it, opened as a workspace tab.
Rules: this computer only, and managed Claude accounts that exist only inside WSL are refused; only
  one session can own a given conversation, and a second attempt names the current owner; Codex
  events and Claude's streamed events are turned into one shared timeline of text, tools, subagents
  and compaction; the app refuses structured requests while the switch is off; if the owning session
  cannot prove its agent process still runs, it lets its claim lapse so another session can take the
  conversation over.
Acceptance:
  - [ ] Switches on, launch Codex locally → a chat tab with no terminal.
  - [ ] Switches off → creating a structured session is refused.
  - [ ] Open the same conversation from a second session → the attempt is refused and names the
        first owner.
Compat: —
Decision: H: default skip
Source: D-14-033

### CHAT-038 · Background tasks bar with stop controls
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: watches an agent that runs background commands, monitors, agents or workflows.
User sees: a status line listing the running background tasks by kind, each with its own Stop, plus
  a stop-everything fallback when details are unavailable.
Rules: stopping a background task leaves the main turn running and adds nothing to the timeline;
  several stops are tracked one by one, each clears only its own pending state, and a stop result
  from an older session never clears the current one.
Acceptance:
  - [ ] The agent starts a background command → it is listed; Stop → it ends.
  - [ ] Stop one of two background tasks → the other keeps running and the main turn continues.
Compat: —
Decision: H: default skip
Source: D-14-038

### CHAT-039 · Structured sessions report status to the sidebar
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: leaves a structured chat working and looks elsewhere.
User sees: the sidebar shows working, idle or needs attention, plus the model, the tool running and
  the last message; when the turn ends the chat tab gets focus if its workspace is the active one.
Rules: focus moves to the chat only when its workspace is the active one; otherwise only the sidebar
  status changes.
Acceptance:
  - [ ] A turn finishes while its workspace is active → the chat tab is focused.
  - [ ] A turn finishes in another workspace → the sidebar updates and focus stays where it was.
Compat: —
Decision: H: default skip
Source: D-14-039

### CHAT-018 · Stop interrupts the agent
Tier: H · Pushed: 5 · State at 0.15.0: live-unverified
User does: clicks Stop while the agent is working.
User sees: during a turn Send becomes Stop; clicking it interrupts the agent and the working state
  clears.
Rules: any send waiting in the queue is cancelled before the interrupt goes out; a quick
  double-click on Send can never turn into an accidental Stop; Stop is layered above the pane's own
  controls so it can always be clicked; in structured chat Stop asks the agent to cancel, and the
  working row remains until the agent confirms the turn is over.
Acceptance:
  - [ ] Start a long turn and click Stop → the agent is interrupted and a single status row says so.
  - [ ] Double-click Send quickly → one message goes out and nothing is interrupted.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-018

### CHAT-023 · Allow or deny a tool permission in chat
Tier: H · Pushed: 5 · State at 0.15.0: live-unverified
User does: the agent asks to run something; the user clicks Allow or Deny.
User sees: a card asking whether to let the action go ahead, with Allow and Deny, plus a Review plan
  button when the request is to leave plan mode.
Rules: an open approval marks the session as needing the user; separate approvals are tracked on
  their own, and one the user dismissed stays dismissed.
Acceptance:
  - [ ] The agent asks to run a shell command → a card with Allow and Deny; Deny → the agent is told
        no.
  - [ ] The agent asks to leave plan mode → the card also offers Review plan.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-023

### CHAT-025 · Links in chat open files and web pages
Tier: H · Pushed: 5 · State at 0.15.0: live-unverified
User does: clicks a file path or a web link in an agent message.
User sees: file paths open in the editor at the given line and column; web links offer a small
  choice between the in-app browser and the system browser.
Rules: paths relative to the repository, and paths followed by a line and column, are understood;
  only paths the agent itself printed recently can be opened, and text the user typed does not
  count; a modifier-click opens the main browser choice and Shift with the modifier opens the other
  one; email links behave as they normally would; page anchors, unknown link kinds, malformed file
  links and empty links cannot be clicked.
  Space opens a focused link like Enter, which shows a focus ring; in the two-browser choice the
  arrows, Home and End move between the choices, Escape or a click outside closes it, and focus goes
  back to the link unless an in-app pane took it.
Acceptance:
  - [ ] Click a file reference in a reply that names line 12, column 3 → the editor opens at line
        12.
  - [ ] Click a web address → a small popup offers the two browsers.
  - [ ] Click a path that only the user typed → nothing opens.
  - [ ] Tab to a link, press Space → the choice opens; press Escape → it closes and the link is
        focused again. (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-025

### CHAT-009 · Hidden chats pause reading and keep their last good view
Tier: H · Pushed: 9 · State at 0.15.0: live-unverified
User does: switches away from a chat and back, or briefly loses the terminal connection.
User sees: on return the conversation is there at once and catches up; after a reconnect the message
  box and its draft are still there; a read failure after content was shown leaves that content in
  place instead of filling the pane with an error.
Rules: a chat that begins hidden reads nothing, and hiding stops reading and cancels any pending
  retries; showing it again starts one new read whose first snapshot replaces whatever was stale;
  kept messages are thrown away if the session behind the pane changed while it was hidden; a
  full-pane error appears only when nothing was kept.
Acceptance:
  - [ ] Hide a chat for a minute while the agent works, then show it → the new turns appear with no
        repeats.
  - [ ] Drop and restore the terminal connection → the text typed in the box survives.
  - [ ] Break the transcript after messages were shown → the messages stay and no full-pane error
        appears.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-009

### CHAT-034 · Structured chat never loses or repeats messages
Tier: H · Pushed: 9 · State at 0.15.0: hidden
User does: chats, then quits or crashes the app, and opens it again.
User sees: the whole conversation exactly as before, with nothing missing and nothing doubled.
Rules: each session keeps a durable journal on this computer, and a retried send is applied only
  once; a damaged journal is rebuilt from the agent's own history; chats stored in the older format
  are brought across once, with a line saying so; a journal saved by a later app version can be read
  but is never written back; items follow their recorded sequence even when clock times go
  backwards, and an item removed by a rewind never returns through a late update; the repair notice
  names the stored line that could not be read; the agent's echo of a sent message merges into the
  same bubble rather than adding another.
Acceptance:
  - [ ] Kill the app mid-turn and reopen → every message once, in order.
  - [ ] Open a journal saved by a newer version → it is read-only and left unchanged on disk.
Compat: A durable per-session journal kept in a small embedded database; chats saved in the earlier
  chat format are brought across once.
Decision: H: default skip
Source: D-14-034

### CHAT-035 · Structured chat delivery status and provider errors
Tier: H · Pushed: 9 · State at 0.15.0: hidden
User does: sends a message in structured chat while delivery fails or the provider reports an error.
User sees: a note that delivery is unconfirmed or that the message was not sent, with Retry;
  provider failures appear as short readable notices whose detail expands.
Rules: the provider's start-up progress and lifecycle messages stay out of the timeline, while
  failures and unrecognised messages with real content are shown; a notice opens with the provider's
  own wording, not the internal method name; streamed fragments of an unrecognised kind are added to
  the item they belong to and never get rows of their own.
Acceptance:
  - [ ] Cut the provider off during a send → an unconfirmed note with Retry; press Retry → sent
        exactly once.
  - [ ] Make the provider fail → a short notice whose detail expands.
Compat: —
Decision: H: default skip
Source: D-14-035

### CHAT-041 · Structured session processes are cleaned up
Tier: H · Pushed: 9 · State at 0.15.0: hidden
User does: closes the chat tab or quits.
User sees: the agent process ends once nothing shows the chat any more; a turn in progress is
  allowed to finish first; quitting does not hang.
Rules: if the agent process exits unexpectedly it is resumed where that is possible; showing a chat
  resumes its agent, while a chat kept only as background history does not start one.
Acceptance:
  - [ ] Close the only chat tab → the agent process is gone within seconds.
  - [ ] Quit while a turn is running → the app finishes quitting without hanging.
Compat: —
Decision: H: default skip
Source: D-14-041

### CHAT-028 · Files the agent wrote, with send to another agent
Tier: H · Pushed: 11 · State at 0.15.0: live-unverified
User does: looks below a finished turn, then sends one of the listed files to another agent.
User sees: up to four files the agent wrote, newest first; sending one puts its path into the other
  agent's draft without sending it.
Rules: nothing reaches the other agent until the user presses Enter there.
  the Send result to list closes on Escape (focus back on its summary) and on a click outside, and
  that Escape never reaches the agent.
Acceptance:
  - [ ] A turn writes six files → the four newest are listed.
  - [ ] Send one to agent B → its path is in B's draft and B has not been prompted.
  - [ ] Open Send result to, press Escape → the list closes and the agent is not interrupted.
        (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-028

### CHAT-001 · Experimental switches for chat view, its default, and structured chat
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: opens the experimental part of settings, turns on the chat switch, then may choose which
  view new agent tabs use and opt into structured chat.
User sees: a main switch that names the agents it supports; once it is on, a Default view choice
  (Terminal chat or Chat UI) appears; once Chat UI is the default, a third switch for structured
  chat appears with a note that it only works on this computer.
Rules: all three start off; turning the main switch on changes only supported local sessions created
  afterwards, while terminals already open stay as they are; the default-view choice is visible only
  while the main switch is on, and the structured switch only while Chat UI is the default; hiding a
  dependent control keeps its saved value, which comes back when its parent is switched on again;
  the structured note explains that WSL and remote hosts stay on the terminal view, and that Windows
  falls back to it when the app cannot read process start times; the rebuild folds the experimental
  section away, so these turn into build-time choices rather than switches the user flips.
Acceptance:
  - [ ] Fresh profile → all three are off and only the main switch is visible.
  - [ ] Turn the main switch on → the default-view choice appears set to Terminal chat; pick Chat UI
        → the structured switch appears, off.
  - [ ] Turn structured on, set the default back to Terminal chat, then to Chat UI again →
        structured is still on.
Compat: Three stored yes/no preferences, each off by default.
Decision: H: default skip
Source: D-14-001

### CHAT-003 · Flip a tab between chat and terminal with a shortcut
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: presses Cmd+Shift+J (Ctrl+Shift+J on Windows and Linux) in a supported agent tab, or
  picks the menu item that returns to the terminal.
User sees: the focused pane swaps between the raw terminal and the chat of the same session; each
  tab remembers its choice across restarts.
Rules: the shortcut acts on the focused split; the tab title is used to guess the agent only for
  tabs with one pane; the same chord with Alt added does nothing; the view choice is saved with the
  session, and tabs saved before this feature existed reopen as terminals; switching never restarts
  the agent process, because both views read the same session.
Acceptance:
  - [ ] Press the chord twice in a Claude tab → chat, then terminal, and the process stays the same
        throughout.
  - [ ] Quit and reopen with a tab showing chat → it comes back as chat.
  - [ ] Press Ctrl+Alt+Shift+J → nothing happens.
Compat: The chord is fixed rather than a rebindable command; each tab's chosen view is part of the
  saved session layout.
Decision: H: default skip
Source: D-14-003

### CHAT-004 · Right-click menu inside chat
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: right-clicks on the conversation or in the message box.
User sees: a pane menu with copy and paste, back to terminal, continue or fork the session, split
  right or down, equalize, collapse or expand, set the title, copy the session, terminal and pane
  ids, and close the pane.
Rules: in terminal-backed chat the split items behave exactly like terminal pane splits; in
  structured chat they move the chat tab within its workspace; copy takes the current selection and
  paste lands in the message box; structured chat lists only workspace layout items and leaves out
  commands that make sense only for a terminal.
Acceptance:
  - [ ] Right-click in chat and choose the way back to terminal → the pane shows the terminal.
  - [ ] Choose split right → a new pane opens next to the chat.
  - [ ] Right-click in a structured chat → no terminal-only items are listed.
Compat: —
Decision: H: default skip
Source: D-14-004

### CHAT-005 · New agent tabs can open straight into chat
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: with Chat UI chosen as the default view, launches a supported agent.
User sees: the new tab opens as chat rather than terminal, with launch choices such as model and
  effort already applied.
Rules: it needs the main switch, Chat UI as the default and a supported agent; otherwise the tab
  opens as a terminal; a launch that carries a starting prompt opens as chat only if that prompt can
  be placed in the chat message box; otherwise it opens as a terminal; a remote session whose
  transcript cannot be read here always opens as a terminal; launch options are applied only when
  the tab really ends up as chat.
Acceptance:
  - [ ] Default set to Chat UI, launch Codex → the tab opens as chat.
  - [ ] Default set to Terminal chat, same launch → the tab opens as a terminal.
Compat: —
Decision: H: default skip
Source: D-14-005

### CHAT-008 · Long conversations load in pages
Tier: H · Pushed: — · State at 0.15.0: live-unverified
User does: scrolls to the top of a long chat and asks for earlier messages.
User sees: the latest 300 messages at first; each press of Load earlier messages adds 200 older
  ones, and the control disappears once the beginning is reached.
Rules: loading an older page keeps the reading position where it was; hiding and showing the chat
  while a page loads never mixes in a page from the earlier read; structured chat brings back a
  recent stretch on open and fetches older history page by page on request, and an older page
  arriving late never pushes back newer live content.
  a failed Load earlier messages call says so under the button ("Could not load earlier messages.
  Press the button again to retry.") and the button can be pressed again.
Acceptance:
  - [ ] A 1,000-message transcript → 300 shown; press twice → 700; keep pressing until the start →
        the control is gone.
  - [ ] Press the control while reading → the message that was at the top of the view stays in
        place.
  - [ ] Make the earlier-messages call fail → a line under the button says it could not load and to
        press again; pressing again retries. (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-008

### CHAT-019 · Autocomplete for slash commands, skills and file mentions
Tier: H · Pushed: — · State at 0.15.0: live-unverified
User does: types / at the start of a line, @ after a space, or $ in a Codex chat.
User sees: a menu of commands, skills (grouped as project, personal, built-in and plugin) or files
  that narrows while typing; Tab completes and Enter runs.
Rules: ranking puts an exact match first, then names that start with the text, then fuzzy matches,
  then matches in the description; Claude lists skills under /, while Codex uses $ for skills; when
  the session reports its own command list, that list is used instead of scanning the disk; skill
  loading has loading, unavailable and error states, and the error offers Retry; a name that is both
  a command and a skill is marked as one the agent decides; dismissing the menu for a word keeps it
  closed for that word; a skill search that finished empty says so, separately from one still
  loading, and commands stay pickable while skills load; clicking an entry picks it on press, the
  same as choosing it by keyboard.
Acceptance:
  - [ ] Type /comp → the compact command is first.
  - [ ] Type @ and the start of a folder and file name → matching files are listed and Tab inserts
        the path.
  - [ ] Make the skill scan fail → an error with Retry.
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-019

### CHAT-021 · Attach images and files to a message
Tier: H · Pushed: — · State at 0.15.0: live-unverified
User does: pastes an image, drops a file on the chat, or uses Attach file.
User sees: chips with thumbnails above the box, a spinner while each one is saved, a full-size
  preview on click, and a remove button.
Rules: Send is disabled while any attachment is still being saved; a drop counts only when it lands
  on this pane; pasting an image is refused with a message for agents that cannot accept images; too
  many attachments waiting at once are refused with a message; thumbnails try again after the image
  cache refreshes, and a broken one says the preview is unavailable; pasted images get a plain
  generic name, while picked or dropped files keep their own name.
  the full-size preview takes focus when it opens, Escape closes it, and focus goes back to the chip
  that opened it.
Acceptance:
  - [ ] Paste a screenshot → a chip with a thumbnail, and Send stays disabled until it is saved.
  - [ ] Drop a file on a different pane → nothing is attached here.
  - [ ] Open a preview, press Escape → it closes and focus is back on the chip. (evidence/T-678.txt)
Compat: —
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-021

### CHAT-024 · Model and effort controls beside Send
Tier: H · Pushed: — · State at 0.15.0: live-unverified
User does: picks a model, an effort level or fast mode from the controls next to Send.
User sees: the model in use as read from the agent, a list of choices with the agent's own default
  named, and effort levels from minimal to max; each change shows as confirmed, or as sent but not
  yet confirmed.
Rules: for Claude, the model is read from the agent's on-screen header and a switch asks the user to
  confirm, staying in chat when it succeeds; for Codex, changes go through Codex's own picker by
  switching to the terminal; a toggle whose current value is unknown shows On and Off without
  guessing; the controls are disabled while the agent works; choices are saved per agent and used
  for the next launch, and models the provider no longer offers are forgotten; options that can only
  be set when a session starts say so; in structured chat a bare /model opens the model picker
  instead of being sent as text; /model followed by words that match no known model leaves the shown
  model as it was; a failure reported for a change that a newer change has already replaced is
  ignored.
Acceptance:
  - [ ] Pick another Claude model and confirm → the agent's header and the picker both show it.
  - [ ] The saved model has been withdrawn by the provider → the next launch uses the agent's
        default.
Compat: One stored set of launch choices per agent, empty by default.
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-024

### CHAT-026 · Chat text zoom
Tier: H · Pushed: — · State at 0.15.0: live-unverified
User does: presses Cmd or Ctrl with plus, minus or zero while the chat has focus.
User sees: chat text gets bigger or smaller in steps of a tenth, between 0.8x and 1.6x; zero goes
  back to normal.
Rules: the zoom lasts only for the current session.
  the zoom level is shown for about a second after each change.
Acceptance:
  - [ ] Press plus ten times → it stops at 1.6x; press zero → back to 1x.
  - [ ] Press minus five times → it stops at 0.8x.
  - [ ] Press plus once → the level (for example 110%) shows briefly, then disappears.
        (evidence/T-678.txt)
Compat: The three chords are fixed inside chat rather than rebindable commands.
Decision: H: default build: the Agents screen (area 05) already shows supported sessions as
  terminal-backed chat with the switch off, so its everyday path relies on this.
Source: D-14-026

### CHAT-029 · The launch prompt waits in the chat box
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: launches an agent into chat with a starting prompt.
User sees: the starting prompt sits in the message box until it is sent, then clears once the
  transcript shows it.
Rules: the prompt is placed only into an empty box and never overwrites what the user typed; it is
  retired once a send clears the agent's input line, or when the tab is closed.
Acceptance:
  - [ ] Launch into chat with a prompt → the prompt is in the box; send → the box is empty and the
        prompt is in the conversation.
  - [ ] Type in the box before the prompt arrives → the typed text stays and the prompt is not
        placed.
Compat: —
Decision: H: default skip
Source: D-14-029

### CHAT-031 · Rough chat from terminal scrollback
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: opens chat for a session whose transcript cannot be read.
User sees: a best-effort conversation pieced together from the terminal's text instead of an empty
  view.
Rules: real transcript messages take the place of the pieced-together ones as soon as they can be
  read.
Acceptance:
  - [ ] Block access to the transcript → chat shows turns taken from the screen.
  - [ ] Restore access → the screen-derived turns give way to the real ones.
Compat: —
Decision: H: default skip
Source: D-14-031

### CHAT-036 · Hand a structured session between chat and the agent's terminal
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: moves a structured conversation into the agent's own terminal screen and back again.
User sees: the same conversation carries on in the other place; work done in the terminal appears in
  chat afterwards; this still holds after an app restart.
Rules: quitting during a handoff that got stuck does not freeze the app.
Acceptance:
  - [ ] Hand off to the terminal, type a prompt, hand back → that turn is in the chat.
  - [ ] Hand off, restart the app, hand back → the conversation is intact.
Compat: —
Decision: H: default skip
Source: D-14-036

### CHAT-037 · Compact, clear and rewind a structured conversation
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: runs /compact or /clear, or rewinds to an earlier message.
User sees: compaction shows as a divider; clear begins a new record while keeping the old history;
  rewind goes back to the chosen point.
Rules: these wait until pending work and queued messages are done.
Acceptance:
  - [ ] Run /clear → an empty timeline, with the old conversation still in history.
  - [ ] Rewind to an earlier message → later items disappear and stay gone.
Compat: —
Decision: H: default skip
Source: D-14-037

### CHAT-040 · Reopen a structured chat from session history
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: clicks a past structured session in the session history.
User sees: the chat reopens in its workspace, or a clear message when the chat no longer exists or
  its host is too old or out of reach.
Rules: one click causes exactly one reopen.
Acceptance:
  - [ ] Click a session that was deleted → a readable message that it is gone, and no blank tab.
  - [ ] Click a past session once → exactly one tab opens.
Compat: —
Decision: H: default skip
Source: D-14-040

### CHAT-032 · Reading transcripts of agents running in WSL
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens chat for an agent running inside a WSL distribution.
User sees: the conversation read across the WSL file share; if WSL hangs, an error that can be
  retried rather than a frozen pane.
Rules: WSL reads pass through a guard with a time limit, and a route that keeps failing is set aside
  for a while; home-folder lists are cached for a few minutes.
Acceptance:
  - [ ] The rebuild offers chat for local sessions only → a WSL session stays a terminal.
  - [ ] If revived: stall WSL during a read → a retryable error, never a frozen pane.
Compat: —
Decision: default cut: WSL, remote-host and phone execution left the product with area 18. Revive
  via DECISIONS.md.
Source: D-14-032

### CHAT-043 · Phone take-over locks chat input
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: takes over a session from the phone app.
User sees: the desktop chat box says another device holds the input and refuses sends.
Rules: take-over is tracked per session, never per pane.
Acceptance:
  - [ ] The rebuild has no phone take-over → the desktop box is never locked by another device.
  - [ ] If revived: take over from the phone → every pane showing that session refuses sends.
Compat: —
Decision: default cut: WSL, remote-host and phone execution left the product with area 18. Revive
  via DECISIONS.md.
Source: D-14-043

### CHAT-044 · Chat with agents on SSH and remote hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens chat for an agent on a remote host.
User sees: chat carried through the remote host, attachments uploaded there, or a message that the
  remote side is too old.
Rules: local attachments are refused for remote sessions that cannot take uploads.
Acceptance:
  - [ ] The rebuild offers chat for local sessions only → remote sessions stay terminals.
  - [ ] If revived: attach a local file to a remote session that cannot upload → refused with a
        message.
Compat: —
Decision: default cut: WSL, remote-host and phone execution left the product with area 18. Revive
  via DECISIONS.md.
Source: D-14-044

## Dropped by default (tier D)

- CHAT-032 · Reading transcripts of agents running in WSL · WSL execution leaves with area 18;
  revive via DECISIONS.md.
- CHAT-043 · Phone take-over locks chat input · phone take-over leaves with area 18; revive via
  DECISIONS.md.
- CHAT-044 · Chat with agents on SSH and remote hosts · remote hosts and SSH leave with area 18;
  revive via DECISIONS.md.

## Hidden or retired (tier H)

- CHAT-030 · Chat inside split panes · chat switch, off by default · default skip
- CHAT-042 · Structured chats appear as workspace tabs · all three chat switches, off by default ·
  default skip
- CHAT-002 · Which sessions can be shown as chat · chat switch on the Terminals screen; the Agents
  screen shows it with the switch off · default build
- CHAT-006 · Chat follows the agent's transcript live, even before the file exists · chat switch on
  the Terminals screen; the Agents screen shows it with the switch off · default build
- CHAT-007 · Finding and reading each agent's transcript · chat switch on the Terminals screen; the
  Agents screen shows it with the switch off · default build
- CHAT-010 · Each message once, in order, without system noise · chat switch on the Terminals
  screen; the Agents screen shows it with the switch off · default build
- CHAT-011 · The reply streams in while it is being written · chat switch on the Terminals screen;
  the Agents screen shows it with the switch off · default build
- CHAT-012 · Reasoning, compaction, plans and provider notices · chat switch on the Terminals
  screen; the Agents screen shows it with the switch off · default build
- CHAT-013 · Tool calls fold into the agent's turn · chat switch on the Terminals screen; the Agents
  screen shows it with the switch off · default build
- CHAT-014 · File edits show as diff cards · chat switch on the Terminals screen; the Agents screen
  shows it with the switch off · default build
- CHAT-015 · Subagents appear as one roster row · chat switch on the Terminals screen; the Agents
  screen shows it with the switch off · default build
- CHAT-016 · Responding, thinking and working indicators · chat switch on the Terminals screen; the
  Agents screen shows it with the switch off · default build
- CHAT-017 · Chat message box · chat switch on the Terminals screen; the Agents screen shows it with
  the switch off · default build
- CHAT-020 · Sending from chat types into the agent's terminal · chat switch on the Terminals
  screen; the Agents screen shows it with the switch off · default build
- CHAT-022 · Answer an agent's question with a card · chat switch on the Terminals screen; the
  Agents screen shows it with the switch off · default build
- CHAT-027 · Chat sticks to the newest message · chat switch on the Terminals screen; the Agents
  screen shows it with the switch off · default build
- CHAT-033 · Structured chat sessions that Kolux runs itself · all three chat switches, off by
  default · default skip
- CHAT-038 · Background tasks bar with stop controls · all three chat switches, off by default ·
  default skip
- CHAT-039 · Structured sessions report status to the sidebar · all three chat switches, off by
  default · default skip
- CHAT-018 · Stop interrupts the agent · chat switch on the Terminals screen; the Agents screen
  shows it with the switch off · default build
- CHAT-023 · Allow or deny a tool permission in chat · chat switch on the Terminals screen; the
  Agents screen shows it with the switch off · default build
- CHAT-025 · Links in chat open files and web pages · chat switch on the Terminals screen; the
  Agents screen shows it with the switch off · default build
- CHAT-009 · Hidden chats pause reading and keep their last good view · chat switch on the Terminals
  screen; the Agents screen shows it with the switch off · default build
- CHAT-034 · Structured chat never loses or repeats messages · all three chat switches, off by
  default · default skip
- CHAT-035 · Structured chat delivery status and provider errors · all three chat switches, off by
  default · default skip
- CHAT-041 · Structured session processes are cleaned up · all three chat switches, off by default ·
  default skip
- CHAT-028 · Files the agent wrote, with send to another agent · chat switch on the Terminals
  screen; the Agents screen shows it with the switch off · default build
- CHAT-001 · Experimental switches for chat view, its default, and structured chat · the three
  switches themselves, all off by default · default skip
- CHAT-003 · Flip a tab between chat and terminal with a shortcut · chat switch, off by default ·
  default skip
- CHAT-004 · Right-click menu inside chat · chat switch, off by default · default skip
- CHAT-005 · New agent tabs can open straight into chat · chat switch plus Chat UI as default view,
  both off by default · default skip
- CHAT-008 · Long conversations load in pages · chat switch on the Terminals screen; the Agents
  screen shows it with the switch off · default build
- CHAT-019 · Autocomplete for slash commands, skills and file mentions · chat switch on the
  Terminals screen; the Agents screen shows it with the switch off · default build
- CHAT-021 · Attach images and files to a message · chat switch on the Terminals screen; the Agents
  screen shows it with the switch off · default build
- CHAT-024 · Model and effort controls beside Send · chat switch on the Terminals screen; the Agents
  screen shows it with the switch off · default build
- CHAT-026 · Chat text zoom · chat switch on the Terminals screen; the Agents screen shows it with
  the switch off · default build
- CHAT-029 · The launch prompt waits in the chat box · chat switch plus Chat UI as default view,
  both off by default · default skip
- CHAT-031 · Rough chat from terminal scrollback · chat switch, off by default · default skip
- CHAT-036 · Hand a structured session between chat and the agent's terminal · all three chat
  switches, off by default · default skip
- CHAT-037 · Compact, clear and rewind a structured conversation · all three chat switches, off by
  default · default skip
- CHAT-040 · Reopen a structured chat from session history · all three chat switches, off by default
  · default skip
