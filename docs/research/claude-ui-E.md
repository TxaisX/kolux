# Claude's handling of branches and pull requests, as a user sees it (wave UI lane E)

Source: the public Claude Code docs page on cloud sessions (code.claude.com/docs/en/claude-code-on-the-web,
reached from docs.claude.com), read 2026-11-02. No app was unpacked and no source was read. The notes
below are my own words; no strings, layout or icons were copied.

## What Claude does

- **The agent works on its own branch and pushes it.** A cloud session pushes its work to a branch of
  its own. Pull request creation is GitHub-only; other hosts can be worked on but results cannot be
  pushed back to them.
- **Changes are shown next to the chat, not in a separate panel.** A small "changes" card beside the
  conversation gives the added and removed line counts. Clicking those counts opens the diff. The diff
  compares against the base branch by default, and the user can pick another branch.
- **The pull request is one step away, not a whole screen.** When a session finishes, the user creates
  the pull request from the session view. After that the pull request appears on the same changes card,
  with a small menu next to its title.
- **Review notes travel with the next message.** In the diff, the user can comment on lines and those
  comments go to the agent with the user's next message.
- **Follow-up is automatic once turned on.** An opt-in switch on the pull request's menu lets the agent
  watch it. When a check fails or a reviewer comments, it pushes a fix if the fix is clear, and asks
  first if it is not.
- **Sensitive files are kept back, by name.** When a local repository is uploaded instead of cloned,
  uncommitted changes to files named like credentials (`.env`, key files such as `id_rsa` and `*.pem`)
  are left out on macOS and Linux. A notice names the files that were held back.
- **What stays local is said plainly.** The docs explain that commits which exist only on the user's
  machine are not in a cloud session, and tell the user what to do.

## What Kolux RS takes from this (our own design)

| Claude's idea | Kolux RS version |
|---|---|
| Agent's work lands on its own branch | The automatic flow commits only on the workspace's own branch. It never commits to or pushes the default branch (DT-C90). |
| PR status sits beside the work | The draft pull request's number, the last step and why it stopped show in the app-wide right panel, one compact row per workspace (T-655). |
| Review notes go with the next message | The review-notes list keeps its own place in the window for now. The status block has a slot below its rows, so the list can move under it later without changing the block. |
| Credential-named files held back, with a notice that names them | Kolux goes further, because the repository is public: a likely secret, by name or by a well-known key prefix in the content, or a file over 10 MB stops the commit or push. A notice names the files (DT-C90). |
| GitHub-only pull requests; other hosts limited | Automatic is on by default only where the remote is GitHub. Other remotes and local-only repositories are the user's choice. A repository with no remote shows a small "local only" icon (DT-C89). |
| An opt-in follow-up switch | Not built here. Kolux opens a draft and keeps it up to date with each turn's push; reacting to checks and comments is a later task. |

## What we deliberately do not copy

- Claude asks the user to click to create the pull request. Txais asked for no clicks, so Kolux opens a
  draft by itself. A draft keeps the user in control: nobody is asked to review until the user marks it
  ready.
- Claude's card shows line counts. Our right panel already shows session activity, so the row stays one
  line and shows the pull request number and state, not a diff summary.
