# Architecture

This section is the technical map of Kolux RS. It describes the 0.1.x build as it exists, not a future design. Every claim here can be checked against the source tree.

Start with the [overview](overview.md), or open the [infographic page](infographic.html) for the extended visual version. The diagram itself is [architecture.svg](architecture.svg), which the overview embeds and GitHub renders directly.

| Page | What it covers |
|---|---|
| [Overview](overview.md) | Processes, runtime topology, startup, terminal lifecycle, local doors, updates |
| [Data](data.md) | The profile folder, the SQLite store, settings, the vault, recovery |
| [Security](security.md) | Trust boundaries, the file fence, protected commands, web isolation, update trust |
| [Frontend](frontend.md) | The React shell, state flow, terminal grid, editor, styling, lazy loading |

The diagram is also available as [architecture.svg](architecture.svg), which is what the overview embeds.

Three facts shape everything else:

1. **There is no Kolux server.** The desktop app, the terminal service, and the agent CLIs all run on the user's machine. The only network services the app exposes are loopback listeners with bearer tokens.
2. **Worktrees are ordinary Git worktrees.** Kolux adds a workspace model and a UI, but the files and branches remain standard Git, so the user is never locked in.
3. **The trust boundary is the process, not the agent.** Browser pages are untrusted web content; agent CLIs are third-party programs running with the user's permissions. Kolux guards its own files and commands, but it is not a sandbox for the agents.

If you are changing the app, read [Security](security.md) before touching the file fence, the hook listener, the CLI loopback, the preview server, or the update path.
