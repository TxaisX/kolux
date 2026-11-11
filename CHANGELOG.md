# Changelog

## 0.1.12

Much lighter on your machine:
- **Agent sleep, on by default.** An agent tab (such as Claude Code) that finished its turn and sat untouched for 30 minutes, out of sight, is put to sleep: its session is saved and its program ends, which frees about 0.7 to 0.9 GB each. Wake brings the same conversation back. A tab that is working, waiting on you, holds unsent text or is the one you are looking at never sleeps. Change the delay or turn it off in Settings › General › Experimental.
- Six terminals printing output use about 26 % of a CPU core instead of 59 %.
- Kolux minimised keeps about 300 MB less in memory, and with browser tabs hidden about 350 MB less.
- Large output floods no longer leave gigabytes of memory held afterwards, and typing stays instant (0.1 s instead of 2.7 s) while other terminals flood.

Smoother:
- Moving a pane to another tab or cell, or splitting it, no longer restarts the agent or program inside it.

## 0.1.11

**Kolux RS is now Kolux.** The app has a new name. Your settings, projects and shortcuts move over by themselves on the first start after the update.

Safer in folders you downloaded:
- Kolux no longer pushes into local repositories, or runs programs named in a folder's own git config, when the folder is not one you trust.
- Kolux no longer marks a workspace as trusted in your Claude or Codex settings unless its code is on your own `origin` branches. A stranger's fork or pull request now always gets the agent's own trust question.

Lighter on your machine:
- The window, hidden browser tabs and idle animations use far less CPU and GPU while you are not looking at them.

Things you may notice once:
- Pinned items are not carried over by the rename; pin them again.
- If the update fails, Kolux stops cleanly and asks you to click once to try again.
- The first agent start in a worktree with commits you have not pushed shows Claude's trust question once.
- A repository with no remote named `origin` is no longer pre-trusted; the agent asks instead.

Also: KaTeX (maths rendering) updated to 0.18.11 for a low-severity security fix.
