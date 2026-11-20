# Safety

Know what Kolux guards, what it only warns about, and what it leaves entirely to you. Kolux protects your files, your keys and your work in progress. It is not a sandbox for the agents you run. Read the Agent Permissions note first.

## Agent Permissions: the biggest switch

In Settings, Agents, "Agent Permissions" is **Yolo** by default. Under Yolo, Claude Code starts in its automatic mode: its own safety check approves routine actions and still stops risky ones. Codex starts with no approval prompts but inside its sandbox (the walled-off area it works in): it can change files only in the workspace's own folder. By default the sandbox also keeps its commands off the internet and away from Git's own records, so Codex can edit files but cannot commit, install packages or push. Such a command fails and Codex is told why; it does not ask you. Commit its work yourself, in your own editor or with Git.

Switch it to **Manual** and each agent asks before it acts. Do this if you want a person in the loop. See [Settings](settings.md).

## Where Kolux asks first

| Action | When it asks |
|---|---|
| Closing a tab that is running a program | Always, if the setting is on (default). A tab with an idle shell closes at once |
| Deleting a workspace | By default. A workspace with changes, a lock or a nested workspace always asks |
| Disconnecting Claude | Always: "Disconnect Claude?" |

## Files: the fence

The Kolux window reads and writes files only inside your projects and their workspaces.

- Network shares and the top of a drive are never treated as a project.
- Paths are resolved through shortcuts and links first, so a link cannot lead outside.
- Paths on other computers are refused: "<path> is on another computer; Kolux never opens or checks paths on other machines".

Clicking a link to a program reveals it in its folder instead of running it.

Kolux decides what counts as a program from a fixed list of file types, not from what Windows would do with the file. The list covers scripts and installers and also remote-desktop shortcuts (`.rdp`), Windows Sandbox files (`.wsb`), update packages (`.msu`), provisioning packages (`.ppkg`), `.appref-ms` shortcuts and disk images (`.iso`, `.img`, `.vhd`, `.vhdx`). Opening a file this way needs a full path to a file that exists; a folder, a relative path or a missing file is refused. A name holding a hidden control character is refused too, because Windows can read such a name as a different file than the one shown.

**Show in file manager** stays inside the workspace. Kolux checks each folder on the way to the file, and if any of them is a link (a symbolic link or junction), it refuses with an error saying the path "goes through a link that leads outside the worktree" and opens nothing, so a link cannot lead the file manager to a folder elsewhere. If the file or its folders have been deleted, it shows the nearest folder that still exists, as before. A workspace path that points at another computer is refused as well.

## Other computers and network shares

When Windows reads a file on another computer, such as `\\server\share`, it signs in to that computer with your Windows account. Kolux avoids this: it never opens or checks a path that points at another computer, so a folder it scans or looks up cannot make your sign-in go there.

| Where | What Kolux does |
|---|---|
| Files and links | A path on another computer is refused (see [Files: the fence](#files-the-fence)) |
| Skill folders | When Kolux looks through the agents' skill folders, a workspace on a network share (`\\server\share`) is not scanned, and a link or junction whose target is on another computer is never followed. A workspace on a mapped drive letter, such as `Z:`, is still scanned |

## Secrets

- Saved keys and sign-ins are sealed by the system keyring (Windows' secret store). There is no plain-text fallback.
- Secrets are never sent to the Kolux window.
- The data folder is limited to your Windows account.
- A key that can no longer be unsealed is cleared, and Kolux asks you to reconnect.
- Diagnostics are scrubbed before you share them. See [Troubleshooting](troubleshooting.md).

## A local door that stays shut to web pages

Kolux runs one small listener on your own computer, for agent status hooks. It cannot be reached from the internet. It also refuses web pages running in your browser: a request that looks like a web page request, or that arrives without the one-run secret key, is dropped or answered with an empty "not found".

## Agent status hooks

The switch for these hooks is called "Show what each agent is doing" (Settings, Agents). A status hook is a small script that Claude Code or Codex runs at each event (a turn starting, a tool running, a turn ending) and that reports to Kolux. Kolux installs hooks for these two agents only; every other agent's state is read from its terminal (see [Status words](terminals.md#status-words)).

- **Reports stay on your computer.** Every report goes only to the status hooks listener on your own computer (address `127.0.0.1`), with the one-run secret key. Outside a Kolux pane the hooks do nothing.
- **A backup before the first change.** Before Kolux first changes Claude Code's `settings.json`, it copies the file beside itself with `.bak-kolux` added to its name. A copy already there is never replaced.
- **Switching hooks off puts it back.** Kolux takes out only its own entries and leaves yours.
- **A file Kolux does not understand is left alone.** If a settings file is not valid JSON, or is not an object, Kolux refuses to edit it and says why.

One known issue touches these files. See [Troubleshooting](troubleshooting.md#hooks-messages-and-leftovers).

## Project icons from the web

Kolux has no browser of its own: web links open in your normal browser (Chrome, Edge or any other). Of the connections Kolux makes itself (listed in Settings, General, Privacy), one goes to an address a project chooses: the project's icon, when the project names a picture on the web.

| Limit | What it means |
|---|---|
| Only public https addresses | The address must be https, with no user name or password, and not `localhost`, a home or office network address, or a `.local` or `.lan` name |
| Capped size and time | An icon may be up to 256 KB and must arrive within 8 seconds. Every redirect is checked again, and a redirect from https to http is refused |
| No proxy, no cookies | The fetch never goes through a proxy. With a saved proxy no icon is fetched at all. No cookies are sent |

A public name that secretly points to a local address is caught too: the fetch does its own name lookup and drops local answers.

## What Kolux sends out

Nothing about your use. The list of outside connections is in Settings, General, Privacy. See [Settings](settings.md).

## Trust for folders Kolux makes

Kolux pre-trusts a working folder it creates itself, for Claude and Codex, so an agent's first prompt is not swallowed by a "do you trust this folder" question. Only folders Kolux made are pre-trusted. Your own project folder is not, so an agent may ask that question the first time it opens there; answer it in the pane. Pre-trust for Cursor and Copilot is not built.

<!-- verified against: src-tauri/src/hooks.rs, src-tauri/src/fence.rs, src-tauri/src/links.rs, src-tauri/src/files.rs, src-tauri/src/trust.rs, src-tauri/src/net.rs, src-tauri/src/web_icon.rs, src/chat/send.ts, src/chat/composer.ts, src/App.tsx, src/settings/AgentsPage.tsx, src-tauri/src/agents.rs, src/settings/privacy.ts, src-tauri/src/scm.rs, src-tauri/src/agent_hooks/mod.rs, src-tauri/src/skills.rs, src-tauri/src/onboarding.rs at bf88bbb3 -->
