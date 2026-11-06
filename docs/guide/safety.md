# Safety

Know what Kolux guards, what it only warns about, and what it leaves entirely to you. Kolux protects your files, your keys and your work in progress. It is not a sandbox for the agents you run. Read the Agent Permissions note first.

## Agent Permissions: the biggest switch

In Settings, Agents, "Agent Permissions" is **Yolo** by default. Under Yolo, Claude Code starts in its automatic mode: its own safety check approves routine actions and still stops risky ones. Codex starts with no approval prompts but inside its sandbox (the walled-off area it works in): it can change files only in the workspace's own folder. By default the sandbox also keeps its commands off the internet and away from Git's own records, so Codex can edit files but cannot commit, install packages or push. Such a command fails and Codex is told why; it does not ask you. Commit its work yourself from Source Control.

Switch it to **Manual** and each agent asks before it acts. Do this if you want a person in the loop. See [Settings](settings.md).

## Protected commands: advice for Claude, not a lock

Kolux can make Claude stop and ask before it runs a risky command. When a command matches a rule, Claude shows its own permission prompt: "Kolux protected action: <name>. The command waits for you; allow it once to run it, or refuse to leave it unrun."

| Rule | What it catches |
|---|---|
| Stripe changes | Commands that change your Stripe account |
| Force-push to main | Overwriting the main branch's history |
| Deleting database tables | Dropping tables or other database objects |
| Infrastructure changes | Commands that change cloud or server setup |
| Production deploys | Pushing to a live site |
| Deleting folders outside the workspace | Recursive deletes that reach beyond the workspace |
| Throwing away uncommitted work | Commands that discard changes you have not saved in Git |

The rules look inside wrappers: chained commands, `$( )` substitutions (four levels deep), `sh -c`, `cmd /c`, PowerShell `-Command` and encoded commands, `eval`, `iex` and `wsl`.

**What this is not.** It is a warning, not a safety control.

- It covers **Claude only**. Codex and other agents are not guarded.
- It reads only Claude's Bash and PowerShell tools.
- A command that matches nothing gets no opinion, and a determined command can be written to slip past. The project's own review found four ways to do so.
- It becomes a real control only when the project owner decides so.

**Switching rules on and off.** Settings, Safety has a "Protected actions" section: one master switch, "Ask before protected actions", and under it one switch for each rule above, each with two example commands. Switch a rule off and Claude stops asking about that kind of command; switch the master off and no rule asks, whatever its own switch says. All of them are on until you change them. The page also tells you when the agent status hooks are off, because Claude cannot ask without them (Settings, Agents). The switches are saved in `settings.json` as `protectedAsk` (on unless saved otherwise) and `protectedOff` (the rules switched off), and changes apply on the next command. If a switch cannot be saved, the page shows what is saved, not what you clicked.

## Where Kolux asks first

| Action | When it asks |
|---|---|
| Closing a tab that is running a program | Always, if the setting is on (default). A tab with an idle shell closes at once |
| Deleting a workspace | By default. A workspace with changes, a lock or a nested workspace always asks |
| Discarding changes in Source Control | Always. It spells out what will be lost |
| Disconnecting Claude | Always: "Disconnect Claude?" |
| Closing the window with unsaved editor text | Always: Keep working, or Quit without saving |

## Files: the fence

The Kolux window reads and writes files only in two places: inside your projects and their workspaces, and single files you pick yourself with the "Open a file" choice.

- A file you pick is granted exactly, never its folder. At most 100 such grants are kept, oldest dropped, so tabs you reopen still work.
- Network shares and the top of a drive are never treated as a project.
- Paths are resolved through shortcuts and links first, so a link cannot lead outside.
- Paths on other computers are refused: "<path> is on another computer; Kolux never opens or checks paths on other machines".

When you do hit the fence, the editor says "<path> is outside your projects; Kolux reads and writes only inside them". It then offers **Open this file anyway**, which grants that one file for this session and nothing beneath it. Clicking a link to a program reveals it in its folder instead of running it.

Kolux decides what counts as a program from a fixed list of file types, not from what Windows would do with the file. The list covers scripts and installers and also remote-desktop shortcuts (`.rdp`), Windows Sandbox files (`.wsb`), update packages (`.msu`), provisioning packages (`.ppkg`), `.appref-ms` shortcuts and disk images (`.iso`, `.img`, `.vhd`, `.vhdx`). Opening a file this way needs a full path to a file that exists; a folder, a relative path or a missing file is refused. A name holding a hidden control character is refused too, because Windows can read such a name as a different file than the one shown.

**Show in file manager** in Source Control stays inside the workspace. Kolux checks each folder on the way to the file, and if any of them is a link (a symbolic link or junction), it refuses with an error saying the path "goes through a link that leads outside the worktree" and opens nothing, so a link cannot lead the file manager to a folder elsewhere. If the file or its folders have been deleted, it shows the nearest folder that still exists, as before. A workspace path that points at another computer is refused as well.

## Other computers and network shares

When Windows reads a file on another computer, such as `\\server\share`, it signs in to that computer with your Windows account. Kolux avoids this: it never opens or checks a path that points at another computer, so a folder it scans or looks up cannot make your sign-in go there. Three places use this rule:

| Where | What Kolux does |
|---|---|
| Files and links | A path on another computer is refused (see [Files: the fence](#files-the-fence)) |
| The Skills page | A workspace on a network share (`\\server\share`) gets no skills scan; its rows in the Skill folders list say "Not scanned: This folder links to another computer, which Kolux never opens". A workspace on a mapped drive letter, such as `Z:`, is still scanned. Inside a skills folder, a link or junction whose target is on another computer is never followed, whether it is a whole folder or a `SKILL.md` file. A skills folder that is itself such a link shows the same "Not scanned" note |
| The command-line check in Getting Started | A `PATH` entry on another computer is not looked up. When it checks the other `PATH` folders, any that does not answer within a second is passed over, and is not asked again for five minutes, so a folder on an offline drive no longer freezes the window |

The skills scan also has a time limit of 8 seconds. A folder that runs past it shows "Took longer than 8 seconds", and its scan is told to stop at its next entry instead of carrying on in the background.

## Secrets

- Saved keys and sign-ins are sealed by the system keyring (Windows' secret store). There is no plain-text fallback.
- Secrets are never sent to the Kolux window.
- The data folder is limited to your Windows account.
- A key that can no longer be unsealed is cleared, and Kolux asks you to reconnect.
- Diagnostics are scrubbed before you share them. See [Troubleshooting](troubleshooting.md).

## Local doors that stay shut to web pages

Kolux runs two small listeners on your own computer, one for the command line and one for agent status hooks. Neither can be reached from the internet. Both also refuse web pages running in your browser: a request that looks like a web page request, or that arrives without the one-run secret key, is dropped or answered with an empty "not found". Browser tabs inside Kolux open only web addresses (http or https), never local files.

## Agent status hooks

A status hook is a small script (or, for Amp, a plugin) that an agent program runs at each event and that reports to Kolux. Setting them up is described in [Settings](settings.md#hooks-for-gemini-cli-antigravity-and-amp). This section covers what the Gemini CLI, Antigravity and Amp hooks send and how your agents' settings files are kept safe.

### What each hook sends

Every report goes only to the status hooks listener on your own computer (address `127.0.0.1`), with the one-run secret key. Outside a Kolux pane, the Gemini and Antigravity scripts and the Amp plugin do nothing and read nothing. Kolux never blocks these three agents. Gemini CLI gets an empty answer, which means no opinion. Antigravity must be answered before it runs a tool, so Kolux answers "allow", which hands the decision back to Antigravity's own rules. Amp's plugin waits for no answer.

| Agent | What the hook posts | What Kolux reads from it | What it never sends |
|---|---|---|---|
| Gemini CLI | The whole event as Gemini CLI hands it over | The event name, session, your prompt (at the start of a turn), the tool name and its input, and the reply text (at the end of a turn) | Nothing beyond the event itself |
| Antigravity | The whole event as Antigravity hands it over | The conversation id, your prompt, the tool name and its arguments, and whether the agent is fully idle | The conversation transcript is not read. Reading it for a reply text is not built yet |
| Amp | A short message the plugin builds itself: event name, thread id, tool name and end status | Those four fields, plus your message text, only when a turn starts | Tool input is never sent, and never held for later. No reply text |

When Kolux is closed or does not answer in time, the Gemini and Antigravity scripts hold the whole event in a small file and Kolux reads it at the next start. That includes tool events, so tool input can sit in that file until then. The Amp plugin holds only its short message, and drops tool events instead of holding them.

### Your settings files are backed up and restored

- **A backup before the first change.** Before Kolux first changes Gemini CLI's `settings.json` or Antigravity's `hooks.json`, it copies the file beside itself with `.bak-kolux` added to its name. A copy already there is never replaced. A file that did not exist has nothing to copy.
- **Switching hooks off puts it back.** If what remains matches the backup, Kolux writes the backup's own bytes, so the file is byte for byte what it was. If you changed the file in the meantime, Kolux takes out only its own entries and leaves yours.
- **Amp is simpler.** The plugin is a file Kolux owns outright, so there is no backup; switching hooks off deletes it. Kolux only deletes or replaces a file whose first line says Kolux wrote it. A file of yours with the same name is left untouched.
- **A file Kolux does not understand is left alone.** If a settings file is not valid JSON, or is not an object, Kolux refuses to edit it and says why. In Gemini CLI's file it also refuses a `hooks` value that is not an object, or an event (such as `BeforeTool`) whose value is not a list. In Antigravity's file it also refuses a `kolux-rs` bundle that is not Kolux's.
- **Your choice on the bundle stays.** An Antigravity `kolux-rs` bundle set to `"enabled": false` stays off, and Kolux reports it as "disabled".
- **If the backup is damaged,** Kolux stops and installs nothing rather than trust it.

Two known issues touch these files. See [Troubleshooting](troubleshooting.md#hooks-messages-and-leftovers).

## Browser tabs: what pages may do

Pages in a browser tab are not trusted. Kolux limits three things.

| Limit | What it means |
|---|---|
| Pages opening tabs | Pages share one allowance of 5 new tabs per 10 seconds, whether they ask for a new window or a link opens as a tab. Extra ones are dropped silently. A page that loops cannot fill your window. The allowance is shared by all pages, so a noisy page can also use up what your own clicks need for a few seconds |
| Where a tab may go | A new tab, a redirect or a script can go only where the address box could. Links to files and to the app's own pages are refused |
| Site icons | Kolux fetches a page's icon itself, so it caps the fetch (an image up to 256 KB, 5 redirects, 8 seconds) and refuses a redirect from https to http. A public page cannot make Kolux fetch an icon from `localhost`, a home or office network address, or a `.local` or `.lan` name unless the page is on that same host |

One gap is known: a public name that secretly points to a local address is not caught by the icon rule. Kolux sends no cookies with the fetch, and the local hooks door still wants its secret key. See [Files and browser](files-and-browser.md).

## Chat messages and menus

On the Agents page, the chat box types into the agent's terminal. A menu such as a permission prompt has "Yes" pre-picked, so an Enter typed into one would approve it. Kolux therefore sends a chat message only when it can see that the agent is not asking, and it checks again for the session the message belongs to before every key. If it cannot see the agent's prompts, or the agent is asking, the message is held with a note. "Request changes" on a plan follows the same rule: it waits until the agent has left its menu and otherwise tells you to answer in the terminal. See [Board, Agents and Inbox](board-agents-inbox.md).

## What Kolux sends out

Nothing about your use. The list of outside connections is in Settings, General, Privacy. See [Settings](settings.md).

## Trust for new workspaces

Kolux pre-trusts the workspaces it creates, for Claude and Codex, so an agent's first prompt is not swallowed by a "do you trust this folder" question. Only workspaces Kolux made are pre-trusted. Pre-trust for Cursor and Copilot is not built.

<!-- verified against: src-tauri/src/protected.rs, src-tauri/src/hooks.rs, src-tauri/src/fence.rs, src-tauri/src/links.rs, src-tauri/src/files.rs, src-tauri/src/cli.rs, src-tauri/src/trust.rs, src-tauri/src/browser.rs, src/chat/send.ts, src/chat/composer.ts, src/App.tsx, src/settings/AgentsPage.tsx, src-tauri/src/agents.rs, src/settings/privacy.ts, src-tauri/src/scm.rs, src-tauri/src/agent_hooks/mod.rs, src-tauri/src/agent_hooks/vendors.rs, src-tauri/src/skills.rs, src-tauri/src/onboarding.rs at 73f5e38 -->
