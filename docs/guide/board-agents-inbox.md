# Board, Agents and Inbox

Use these views (and the Tower) to see what every session is doing, answer a permission request without hunting for its pane, and find the sessions that need you.

## The Board

Open it from the screen switcher in the top bar. Each terminal pane in any workspace is one card. Editor and browser tabs get no card. Shells and chooser panes that have not started sit in Idle. With no sessions the Board says "No session yet."

### Lanes

Lanes run left to right. A lane is drawn only when it holds a card.

| Lane | Cards in it |
|---|---|
| Needs you | Waiting on a permission or a question |
| Working | Running, starting, queued, or with no recent update |
| Done | Finished a turn |
| Stopped | Exited, interrupted, or blocked |
| Idle | Nothing running, or not started |

### What a card says

| State | Lane | Line on the card |
|---|---|---|
| Needs permission | Needs you | The tool and detail, with Approve and Deny |
| Asked a question | Needs you | Every question it asked, joined by " · " ("Which framework? · Which database?") |
| Blocked | Stopped | The cause: "Limit reached · resets at …", "Sign in again", or "The AI hit an error" |
| Interrupted | Stopped | "Interrupted" |
| Exited | Stopped | "Exited" |
| Done | Done | The first line of the reply and the newest file written |
| Idle | Idle | Time since it went idle |
| Queued | Working | "Queued" |
| Quiet for a while | Working | "No recent update", and how long since its last status (for example "no status for 12m"). Shown when a working agent prints nothing for a while, or sends no status for 30 minutes |
| Working | Working | Time running and the current tool step |

A meter bar on the card shows how full the AI's memory is (tokens used out of its window) and its plan allowance.

### Approve and Deny

When an agent asks permission to use a tool, its card shows two buttons.

- **Approve** lets the agent carry on.
- **Deny** tells the agent no.

They appear only for a permission request the agent's hooks reported, which names the tool. A permission a program prints into its own output, or one Kolux guesses from the pane title, shows no buttons on the card: answer it in the pane. Questions need an answer typed in the pane. The same two buttons also show in the agent pane's header (see [Terminals](terminals.md)).

### Expand a card

Press Expand on a card to show that session's live terminal inside the card. Press Collapse and the terminal goes back to its grid slot. Only one card is expanded at a time.

## The Agents page

Use it to browse sessions by program rather than by state. The left rail, "Sessions by agent", has one group for each agent you have switched on and installed, then "Other sessions" for anything unmatched.

- Each row shows the agent mark, a name (the title, the folder, or "Session N"), a context ring and a status word.
- The + beside an agent ("Add a <agent> session") adds a not-started session, shown as "New session" and "Not started".
- A footer line shows the picked session's 5-hour allowance and when it resets, for example "Claude 80% left".
- The picked session's terminal (or its chooser), or its chat when it can show one (see below), fills the area beside the rail. Kolux remembers your pick; first run it picks the first agent's newest session.

With no agent switched on the page says "No agents yet" with an "Open Settings" button. With an agent but no session it says "No session yet. Add one with + under an agent."

### Chat on the Agents page

Use it to read a Claude Code, OpenClaude or Codex session as a conversation instead of a terminal, and to talk to the agent without clicking into its terminal. When the picked session can show chat, the chat appears in the page body. A session that cannot (another program, or no saved conversation Kolux can find on this computer) keeps its terminal. While the program is still starting, the page says "Starting...". Kolux checks again every 3 seconds, so chat appears once the session is ready.

The chat follows the agent's saved conversation live, even before that file exists: it says "Loading the conversation..." and then fills in. With nothing said yet it reads "No messages yet. What you and the agent say shows up here." Each message appears once, in order, with its time (hover for the full date). A reply still being written shows faintly until the saved version replaces it. Hover a message for **Copy** and **Top**. Click a picture to see it full size.

**The agent's work inside each turn.** The chat folds the busy parts away so you can read the talk.

| You see | What it is |
|---|---|
| Thought | The agent's reasoning, folded until you open it |
| A line such as "3 steps" | The tool calls of one stretch of work. Open it for each call and its output. A single call shows its own name or command. Running and failed calls are marked |
| A card per file, tagged Added, Edited, Renamed or Deleted | A file edit as a diff (the lines before and after). **Copy diff** copies it. A refused edit shows the agent's error instead |
| "2 subagents working" or "2 subagents ran" | One row for the helper agents. Open it for each helper's state (Working, Idle, Done, Failed, Stopped) and how long it took |
| A divider, a plan, a notice | A compaction (the agent shortening its memory), a plan it wrote, and a message from the AI provider. A notice with more text has a **Details** fold |
| "Responding...", "Working" or "Monitoring background work", with a timer | The agent is busy. "Worked for ..." closes a finished turn |

Only web links in the output are clickable, and they open in your normal browser.

**Fold and unfold from the keyboard.** Thought rows start folded. Tab to one and press Enter or Space to open or fold it. **Expand all** and **Collapse all** sit at the top of the chat whenever it has a Thought row. The step, subagent and Details folds open the same way.

**The message box.** The box at the foot of the chat types into the agent's own terminal, as if you typed there yourself.

| Key | Does |
|---|---|
| Enter | Sends |
| Shift+Enter | Starts a new line (the box grows to about 8 lines) |
| Up, Down | Step through your earlier messages (the last 50), when the cursor is on the first or last line |
| Escape | Nothing in the box. It never reaches the agent, where it would stop the turn |
| Any typing elsewhere in the chat | Goes to the box. Backspace or Delete moves you into it |

Your unsent draft is kept for each session. A message you sent shows faintly until the saved conversation records it. If it never arrives the row says "This message did not arrive. Look at the terminal." A message too long to send at once is refused with a note ("Shorten it or paste it in the terminal") and the box keeps your text. With no live terminal the box says "This session has no live terminal. Switch back to the terminal to reconnect."

**When the box holds your send.** An agent that is asking you something in its terminal shows a menu, and a menu's pre-picked answer is Yes. So Kolux sends only when it can see the agent is not asking.

| The box says | Why |
|---|---|
| "The agent is asking something in its terminal. Answer there." | The agent wants permission or an answer. You can still write a draft, but it will not send until the agent is no longer asking |
| "Kolux can't see this agent's prompts. Type in its terminal." | Kolux has no status report from this agent: its hooks are off, Codex has not been trusted, or no event has come yet |

Before each key it types, Kolux checks again for the session the message was sent to, not the session on screen now. If the agent starts asking half way through a send, the rest is dropped.

**Scrolling.** The chat follows new messages while you are at the bottom (within about 48 pixels). Scroll up and it holds still while replies stream in. A **Jump to latest** button takes you back. After you send, the view goes to the bottom. With no session picked in the rail, the box types into the first agent that can chat, and a line says "Typing into <name>".

Not there yet: a **Show terminal** switch on the chat, answering an agent's question with a card in the chat, and chat for Grok and omp. Use the terminal for those.

### Request changes on a plan

In the plan review sheet (the "Review plan" button on a pane), **Request changes** denies the plan and types your comments into the agent. Kolux first waits up to about 3 seconds for the agent to leave its permission menu, because an Enter typed into an open menu would pick its pre-picked answer, Yes. If the agent is still asking, a notice says "The agent is still asking. Answer it in its terminal; your feedback was not typed." If Kolux cannot answer the agent at all, it says "Kolux could not answer the agent. Answer it in its terminal; your feedback was not typed." In both cases type your feedback in the terminal yourself.

## The Inbox

Use it to see everything that wants your attention. Press the bell in the top bar. Press it again, or press Escape, to leave.

| Group | Contents |
|---|---|
| Needs you | Rows labelled Permission, Question or Blocked. A blocked session — a limit, a sign-in or an error — stays here, though the Board and the Tower show it as Stopped |
| Waiting on agent | Rows labelled Running or Queued |
| Done today | The 20 newest sessions that finished their turn in the last 30 minutes and whose program is still running. Interrupted ones are left out |
| Stopped | The 20 newest sessions whose program exited in the last 30 minutes. A program that has exited cannot say its work finished, so its session is never listed under Done today |

When nothing needs you the page says "All clear. Nothing needs you." With no sessions at all it says "Sessions show up here as they ask, run and finish."

Up and Down walk the rows. Enter or a double-click opens that session's pane. A detail panel shows the Agent, Branch, Workspace, Changes ("N files changed, M staged" or "No files changed") and the last Prompt, and puts the session's own status word beside its name (Permission, Question, Blocked, Running, Queued, Done or Stopped).

The detail's first button reads "Answer in Code" for a session that needs you and "Open in Code" otherwise, and opens that session's pane. When the agent's terminal is still running, the detail also reads the open prompt off its screen and offers the answers as buttons: one click types the chosen answer into the agent. If the prompt cannot be read for sure, it offers only Answer in Code. When the terminal has already exited, a line says so ("Its terminal has exited, so the prompt cannot be answered from here. Answer in Code to see it in the pane."); a stopped session that needs you gets "The agent stopped and its terminal has exited. Open its pane in Code to see why." instead.

A Done today row offers **Review changes** when its workspace is known; a Stopped row offers it once that workspace is known to hold changes. Either opens the workspace's All Changes.

## The Tower

Use it to watch every agent at once, for example on a second screen. Click Tower in the screen switcher, and pick another view to leave. "Show Tower" in the keyboard shortcuts has no key until you give it one. The Tower is a screen in the main window; it does not open a window of its own yet.

Across the top, a summary card counts the agents and how many are in each lane (for example "2 needs you"). Next to it is one usage card per AI program (Claude, Codex) with its 5-hour and weekly bars and how many panes it runs in. When those panes use named accounts, the card lists each account with its pane count. The bars are the program's figures for the account Kolux reads usage from, so they are shown once per program, never under each account's name. Without figures yet a card says "No usage figures yet".

Below, every agent pane is one row, grouped Needs you, Working, Done, Stopped, Idle, with the newest change first in each group. A row shows the pane's name, the program and account, the branch and folder, the status word with its line (the same words as the Board), and the context and plan figures. Shells and editor or browser tabs get no row. With no agent running it says "Nothing is running. Start an agent and it shows up here."

Click a row, or walk the rows with Up and Down and press Enter, to open that pane.

## The Floor

Use it to see when each agent worked, waited for you or sat idle. It has no button yet: give "Show Floor" a key in the keyboard shortcuts, then press it. Pick another view to leave.

Each agent pane is one lane, named after its terminal. Coloured stretches show Working, Needs you (a permission, a question or a block), Idle and Unverifiable. Unverifiable means the pane's terminal has closed, so Kolux cannot vouch for its quiet stretches. Hover a stretch for its times. Pick the range at the top: 15 minutes, 60 minutes (the default) or Today (from midnight). The page reads again every 5 seconds. With nothing to show it says "No agent reported any activity in this range."

## Automation runs

A finished run's page keeps **Saved output**: the last text the agent's terminal showed when the run ended (about the last 16,000 characters; when older lines were left out, it says so). This also holds when the terminal closes or the program exits before the run is saved: Kolux takes the pane's last text just before its log goes. A run that already has saved output keeps it. It also shows **Tokens and cost** for the run, from the agent's own usage records, and the automation's page adds up its runs. When no usage can be matched, it says "Unavailable" with the reason rather than showing 0. A run's figure counts every session that worked in the same folder while it ran, so a run in a folder where you also work by hand can show your own usage too; a fix is planned. The figure is read when you open the Automations page, so reopen it after a run finishes.

## Status words

The same words appear in pane headers, tabs, the sidebar, the Board and the Inbox.

| Word | Meaning |
|---|---|
| Working | The agent is working on its turn |
| Working (background) | The turn is over, but Kolux is watching the agent's background tasks. Shown as "Working" |
| Needs you | It asked a question, or needs permission for a tool. Every question it asked shows with it; for a plan, its first line |
| Blocked | It cannot go on: a limit, a sign-in or an error. Open the pane to see why |
| Interrupted | The turn was stopped before it finished: you pressed Esc or Ctrl+C and no finish arrived within about 3 seconds. If the agent then starts a new step, it goes back to Working, so a Ctrl+C that only cleared what you were typing does not leave it Interrupted. The tool that was running when you pressed the key finishing up does not count as a new step. With Claude Code, a finish that arrives after the key press, even a late one, shows Done instead, because Claude Code sends no finish for a turn it really stopped. Otherwise it stays until your next prompt |
| Failed | The program could not start |
| Done | The agent finished its turn. Clearing a session (/clear) or compacting it by hand also shows Done, without a notification |
| Idle | Nothing is running here |
| Queued | Waiting for its turn to start |
| No recent update | No status has arrived from this agent for a while: it printed nothing for some minutes, or, while working, sent no status for 30 minutes. It clears with the next status |
| Starting | The program is starting up |
| Cannot reach | Kolux cannot talk to this agent |
| Stopped | The program has stopped |

A plain shell reads "Ready" while it runs and "Ended (code)" after it exits. A session not yet started reads "Not started" on the Agents page.

Until an agent's status hooks report, Kolux guesses its state from the title the program gives its terminal. A spinner or a word such as "thinking" reads Working, "ready" or "idle" reads Done, and "permission", "waiting" or "action required" reads Needs you. Gemini CLI's own title icons count too: ✦ reads Working, ✋ reads Needs you and ◇ reads Done, whatever words follow them. A title it does not recognise, such as a folder path, changes nothing. The first real status replaces the guess.

### What Gemini CLI, Antigravity and Amp show

Once their status hooks are on (see [Settings](settings.md#hooks-for-gemini-cli-antigravity-and-amp)), these three move the dot as follows.

| Agent | Working | Done |
|---|---|---|
| Gemini CLI | A prompt is sent, and each tool starts or finishes | The turn ends |
| Antigravity | A prompt is sent, and each tool starts or finishes | The agent stops and reports itself fully idle. A stop while it is not fully idle changes nothing |
| Amp | A prompt is sent, and each tool starts or finishes | The turn ends normally |

- **Needs you:** Kolux shows it when one of these agents calls a tool named `ask_question` or `ask_permission`. Kolux wrote that rule for Antigravity's question tools.
- **Interrupted:** Amp tells Kolux itself when a turn ends cancelled or with an error, and the dot reads Interrupted. Gemini CLI and Antigravity send no such report.
- **No Approve or Deny:** none of the three reports a permission request, so their cards show no Approve and Deny buttons. Answer in the agent's terminal. See [Approve and Deny](#approve-and-deny).

A program can also report its own status by printing a hidden code (OSC 9999, with the state working, done, permission, waiting or idle). Kolux reads it and never shows it on screen. Any program running in the pane can print it, so this status is the program's own word, not proof.

## Notifications

Kolux tells you when:

- an agent finishes ("<tab> finished") or a helper agent's turn ends,
- an agent needs permission,
- a turn is interrupted,
- an agent stops: limit reached, sign in again, or the AI hit an error (with a "Resets at …" time when known),
- a session goes quiet: "<tab> has gone quiet for N min", "No terminal output since then. It may be stuck."

When several repositories have agents running, the title includes the repository name. You get a desktop notification only when the pane is out of view or the window is not in front. A toast appears in the app, and an unread mark sits on the tab and workspace until you view it.

Settings, Notifications has three switches and a sound choice (System default, Chime, Ping, Pulse):

| Switch | Default |
|---|---|
| An agent finishes its task or needs permission | On |
| A terminal rings its bell | Off |
| An agent halts on a usage limit, a lapsed sign-in or a provider error | On |

## The usage pill

The pill in the top bar shows how much of your weekly allowance is left for each installed AI program, for example "Claude 80% left". Click it to open Settings at Accounts & keys, on the AI connections section. Hover for the weekly limit and when it resets. It tints as the allowance runs down (warning at 70% used, danger above 90%). See [Getting started](getting-started.md) for the full description.

<!-- verified against: src/board/chip.ts, src/board/paneStatus.ts, src/board/review.ts, src/App.tsx, src/agents/AgentsRail.tsx, src/agents/rail.ts, src/inbox/inbox.ts, src/inbox/InboxView.tsx, src/inbox/exitedPrompt.ts, src/terminal/status.ts, src/terminal/notify.ts, src/chat/ChatView.tsx, src/chat/MessageBox.tsx, src/chat/StepRows.tsx, src/chat/send.ts, src/chat/model.ts, src/chat/composer.ts, src/status/useAgentStatus.ts, src/usage/meter.ts, src/tower/tower.ts, src/tower/TowerView.tsx, src/chrome/TopBar.tsx, src/keys/actions.ts, src-tauri/src/status.rs, src/floor/FloorView.tsx, src/floor/timeline.ts, src-tauri/src/activity.rs, src/automations/RunsDashboard.tsx, src/automations/usage.ts, src-tauri/src/terminal.rs, PLAN.md (T-140-b, T-151-b), src-tauri/src/agent_hooks/mod.rs, src-tauri/src/agent_hooks/vendors.rs at 8bf4d909; the Inbox section checked again at 8bf4d909 against src/inbox/InboxView.tsx, src/inbox/inbox.ts, src/board/review.ts (T-035-c, T-609, DT-C52) -->
