# Reclaiming the old Kolux from your PC

Written 2026-10-30 for Txais, who asked that day for "removing the original kolux and all of its
information beside the documentation build of this application so that we can keep a digital report
on it in the github repo". This page says what the old Kolux left behind, what is safe to delete, what
must stay, and the order to do it in. Nothing here has been deleted on your PC yet: you do that
yourself, with the script `scripts\reclaim-old-kolux.ps1`.

The repository side is already done: the screenshots of the old app that were kept in this repository
were removed on 2026-10-30 (see PROVENANCE.md). The design measurements made from them stay, because
Kolux uses them.

## What the old Kolux left on the PC

- **Its code folders on G:\Dev.** The old repository, its scratch and workspace folders, and backup
  copies of it: 5 folders, named in the first three bullets of section 0 of `LOOP.md` (the
  "NEVER open" list). This page does not repeat their names; the script reads them from `LOOP.md`
  and prints them. Together they take **about 408 GB**.
- **The installed app.** The old Kolux program itself, installed under your user's programs folder.
- **Its agent hooks.** Small scripts (about 9 KB) the old app put in the `agent-hooks` folder inside
  `.kolux` in your user folder (`~\.kolux\agent-hooks`). Claude Code, Codex and Kimi may still be set
  up to run them.
- **Your own settings and data** in `~\.kolux` and `%APPDATA%\kolux`. These are yours, not the old
  app's code, and Kolux still uses them (see below).

## Safe to delete

| What | How |
|---|---|
| The old code folders on G:\Dev (repo, scratch, workspaces, backups) | The script, with `-Delete` |
| The installed old app | Windows **Settings > Apps > Installed apps > Kolux > Uninstall** |

## Leave alone for now

- **The `agent-hooks` folder in `~\.kolux`.** It holds the hook scripts for Claude Code, Codex and Kimi,
  and agents may still be set up to call them; deleting it could make those agents print hook errors.
  It is only about 9 KB, so it is not worth the risk. The script does not touch it.

## Must STAY

- **`~\.kolux` and `%APPDATA%\kolux` as a whole.** Kolux's importer reads them, and Kolux reads
  your shortcuts from `~\.kolux\keybindings.json`.
- **Anything under `~\.kolux-rs`.** That is Kolux's own data, including its release signing key.
- **Your vault notes** (Txais Brain).
- **`G:\Temp\live-signin`.** Test account A for the live checks now lives there.
- **This repository** (`G:\Dev\kolux-rs`). The script refuses to touch it.

## The order

1. **Close the old Kolux and Kolux.** Nothing should be using these folders while they go.
2. **Uninstall the old app** (Settings > Apps > Installed apps > Kolux > Uninstall). Make sure you
   uninstall the old Kolux, not Kolux, if both are listed. Kolux's own hooks live elsewhere and
   are not affected.
3. **Sign test account A in at its new folder.** The live checks used to keep test account A inside
   one of the old scratch folders, which the script deletes. They now use
   `G:\Temp\live-signin\account-a` (or the folder in the `KOLUX_LIVE_ACCOUNT_A` setting, if you set
   one). Open a terminal and run:
   ```
   $env:CLAUDE_CONFIG_DIR = 'G:\Temp\live-signin\account-a'; claude
   ```
   then sign in with test account A and close it.
4. **Get PowerShell 7 if you do not have it.** In any terminal run:
   ```
   winget install --id Microsoft.PowerShell -e
   ```
5. **Look first.** Open PowerShell 7 (start menu: "PowerShell 7", or type `pwsh` in a terminal), go to
   this repository's folder, and run the script without `-Delete`:
   ```
   cd <your clone of kolux-rs>
   pwsh -NoProfile -File scripts\reclaim-old-kolux.ps1
   ```
   This only lists the 5 folders and their sizes; it deletes nothing. Check the list.
6. **Check the backups folder by hand.** In the list, find the backups folder (the one whose name
   ends in `backups`). Open it in File Explorer and move anything that is **not** a copy of the old
   Kolux repository to another place (for example backups of other projects). Everything left in it
   will be deleted.
7. **Delete.** Run the script again with `-Delete`:
   ```
   pwsh -NoProfile -File scripts\reclaim-old-kolux.ps1 -Delete
   ```
   It asks you to type `DELETE` (capital letters). Anything else stops it. It then removes each folder
   and prints how much space came back, about 408 GB in all. If a folder could not be removed (for
   example a file was still open), it says FAILED for that folder; close what uses it and run step 7
   again.

What the script will not do: it takes only the 5 G:\Dev folders that `LOOP.md` section 0 lists, and
stops if that list has changed. It refuses anything outside G:\Dev, G:\Dev itself, this repository,
and any folder that is a link to somewhere else. It does not touch your user folder. Folders that are
already gone are skipped.

## The old GitHub repositories

The old app's two repositories, under the former names **TxaisX/kolux** and **TxaisX/kolux-releases**,
were removed on 2026-10-31 (Txais recorded that in `STATE.md`). Nothing here asks you to archive them.

**Do not archive `TxaisX/kolux` today:** that address is now this app's own repository, and archiving
it would freeze the source, issues and update feed.
