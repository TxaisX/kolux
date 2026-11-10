# Changelog

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
