# Glossary

Kolux uses a few words in a specific way. This page is the short version. The user guide has the full behaviour behind each one.

## Work and isolation

**Project**
A Git repository added to Kolux. Projects appear in the left sidebar. A project has one main checkout and any number of workspaces.

**Main checkout**
The original folder you added. It stays on its own branch and is not a workspace.

**Worktree**
A Git feature: an extra working folder for the same repository, checked out on its own branch. Worktrees share the repository's history but have separate files.

**Workspace**
Kolux's name for a worktree. Each workspace has its own branch, its own folder, and its own sessions. From two agents up, a new lineup gives each seat its own workspace by default.

**Branch**
The Git branch a workspace is on. A workspace can start from `main`, another workspace, or any ref.

## Running agents

**Agent**
An AI coding CLI that Kolux can run in a pane, such as Claude Code, Codex, Gemini CLI, or one of the other supported tools. Kolux can install some agents itself; others you install first.

**Session**
One agent or shell running in a pane, plus the record Kolux keeps so it can be restored after a quit. A session has a state, a workspace, and a terminal.

**Pane**
One cell in the terminal grid. Each pane holds one session. Panes can be split, resized, expanded, and closed.

**Tab**
A container for one or more panes in the grid. Tabs can be split right or down, and a tab's menu can close it or its neighbours.

**Layout**
The saved arrangement of panes and tabs in a workspace. Kolux restores it at the next launch.

**Seat**
One agent slot in a launch lineup. A seat has an agent, a model, and an optional role.

**Shape**
A preset lineup: **Solo** (one seat), **Pair** (builder and reviewer), **Workbench** (scout, builder, reviewer), **Swarm** (five seats), or **Custom**.

**Worker**
An agent started by another agent to do part of a job. Workers run in their own panes and report back to the agent that started them.

**Handoff note**
A note kept per workspace and given to an agent, so the next session knows where the work stands.

## Watching and steering

**Board**
A lane view of every session: Needs you, Working, Done, Stopped, and Idle. Each card can show the live terminal, approve or deny a request, and open the workspace's changes.

**Inbox**
A list of what needs you, what is running, and what finished today. It is the bell in the top bar.

**Tower**
A screen that shows every agent at once, with one row per pane and a summary of each state.

**Floor**
A timeline of when each agent worked, waited, or sat idle, over the last 15 minutes, 60 minutes, or today.

**Status**
What an agent is doing. The main states are **Working**, **Needs you**, **Done**, **Stopped**, and **Idle**. The full list, including Blocked and Interrupted, is in [Board, Agents and Inbox](guide/board-agents-inbox.md#status-words).

**Hook**
A small script Kolux installs in an agent's own settings. The agent runs it on events such as a prompt, a tool call, a permission request, or a finished turn. The hook posts to Kolux's loopback listener.

**Usage**
Token and cost figures, plus plan limits where the provider reports them. Usage comes from local agent records, not from a Kolux service.

## Work items

**Task**
A work item on the Tasks page. A task can be started as a session, and an agent can be launched from a GitHub issue or pull request.

**Automation**
A saved prompt and agent that runs on a timetable or when something happens in a project, such as a pull request opening or an agent finishing.

**Run**
One execution of an automation. Each run has a numbered history entry, saved output, and token and cost figures when they can be matched.

**Artifact**
A file an agent creates that Kolux can list and open in its own viewer.

**Skill**
A folder with a `SKILL.md` file that teaches an agent how to do a job. Kolux can list, inspect, and remove skills from the folders its agents read.

## Git and safety

**Source Control**
The Git panel in the right sidebar. It stages, discards, commits, pushes, pulls, and opens pull requests.

**Checks**
The CI status for a pull request, with the check's steps and annotations.

**Fence**
The rule that Kolux reads and writes files only inside your projects, plus single files you pick yourself. A link cannot lead outside.

**Protected action**
A risky shell command, such as a force-push to main or a production deploy, that Claude must ask about before it runs. The rules are a warning, not a sandbox.

**Yolo and Manual**
The agent permission modes in Settings, Agents. **Yolo** lets Claude Code use its automatic mode and Codex run in its sandbox without approval prompts. **Manual** asks before each action.
