# Audit fix wave: Start form, Discard, shared repositories (2026-11-15)

What the wave of 2026-11-15 and 2026-11-16 changed, how it was run, what the late reviews found in the Discard code,
and what is still open. The asks, in Txais's words: "In the opening of kolux, it should always be asking us what
folders we want to open, how many agents we want, and what model and number we want" and "Find all the bugs and all
the design flaws, and make it better".

Everything here sits on the local branch `integrate/wave-2026-11-15` (361 commits ahead of `main`
`8b6f3307` at `e1168c4d`, before this note was added; 305 files, 12,106 lines added, 3,795 removed). Nothing was
pushed, released or tagged.

## How it was run

- One coordinator session wrote a brief per job and merged. Builder sessions in other Kolux panes did the jobs, each
  in its own Git worktree (one lane per area: design, Start form, page, engine). 102 jobs in all, numbered 1 to 102;
  40 of the reports on file are reviews.
- Every round that changed Rust or a lifecycle got a read-only review on a frozen copy of the lane. A reviewer could
  not edit: its tool grant had no Write. Its hand-back was saved word for word.
- One shared rules file bound every job: no push, one `cargo` user at a time with `-j 6`, never the whole Rust
  suite, Discard tests only in temporary repositories the test itself made.
- A finding rated P0 to P2 that came from the reviewed range was fixed before the merge. An older one was written
  down and fixed after. A P3 note was written down.
- The record of each job is its report, outside the repository:
  `G:\Dev\kolux-lanes\_wave\run-2026-11-15\reports\`.

## What changed

| Area | Now |
|---|---|
| Start | One Start form asks which folders, how many agents, and which AI and model for each. It opens at launch, for a new pane, and for the first folder added after setup. Its sessions fill a never-started pane first; a pane with typed text is left as it is. A setting turns the ask off. |
| Discard (All Changes) | Never deletes a folder that took a file's place, never writes or deletes through a link, never discards a whole folder at once, never writes a deleted file back over a file standing there. A yellow line says why a row was left and what to do next; a real failure is red. |
| Removing a project | Ends only that project's terminals. A project inside it that stays keeps its own, and so does a worktree another project on the same repository lists. The question counts only what will close. |
| Keys | Closing shortcuts wait while a text field has focus, on every layout and the number pad. The delete shortcut always asks. |
| Words and leftovers | "Delete worktree", "Show what each agent is doing", "Show the AI actions for Git", one "End all" button. The old Source Control panel's code and 52 style rules are gone. |

## Discard: the rules now in the code

Discard is the one place in Kolux that can delete a user's file for good. Seventeen fix jobs on it met the same wrong
assumption: that a name Git prints tells which entry of a Windows folder it is. It does not (letter case, look-alike
letters such as the Kelvin sign, names ending in a dot, links). The rules that replaced it:

| Rule | What it says |
|---|---|
| Spelling | On Windows a row acts only under the one spelling the disk holds. |
| Links | A link at a row Git holds under exactly that spelling is removed as a link; what it points to is never touched. Nothing is written or deleted through a folder link or inside a submodule. |
| Empty place (D) | A row only the last commit holds (a staged deletion, a rename's old half) comes back only into an empty place. A file or link standing there is left, with its own line. |
| One entry | Two rows are one disk entry only when Windows itself reports the other row's name for the plain file standing there. Names are never compared by their letters. |
| No copies (D2, E1) | Every status read takes `-c status.renames=true`, so a copied file is a staged new file and its source is never sent to Discard. The page's fallback row carries an old name only for a rename. |
| Order (E2) | Git writes a row only the last commit holds after the rows the index holds, so a letter-case rename gets its old name back instead of losing its one file. |
| Words | Every line Kolux left on purpose holds "so Kolux leaves" and shows yellow; anything else shows red under "Could not discard". |

## What the late reviews found

| Review | Finding | Was it in the released app | Outcome |
|---|---|---|---|
| 94 | Discarding a staged deletion of `notes` wrote the old text over an untracked `NOTES`, with no message | yes | fixed (job 95), re-reviewed |
| 96 | A renamed row could delete an untracked file whose name differs by a look-alike letter | yes | fixed (job 97) |
| 96 | Discarding a staged copy wiped the changes of the file it was copied from (Git set to detect copies) | yes | fixed in the engine's list (job 97) |
| 98 | The same copy loss through the page's second list, in a timing window | yes | fixed (job 99 and the page fallback) |
| 98 | A letter-case rename discarded from upper to lower case left the file deleted on disk (the last commit still had it) | yes | fixed (job 99) |
| 100 | Nothing from the last fixes. One older note (R100-01): a rename that changes only a folder's letter case, with its new half deleted by hand, is written and then deleted with no message, on a route no screen reaches. A second Discard brings it back | yes | written down, not built |
| live check | Sessions started from the Start form landed beside an unstarted "pick an agent" pane instead of filling it, so the first folder after setup ended with one empty pane | the first-folder case is new in this wave | fixed on the page (TERM-007). Review 101 found two gaps in the fix (text typed into an empty pane would be lost; an own-folder team with a setup script kept the empty pane); both closed, review 102 then said commit (no P0 to P2; of its three P3 notes, a tab name on an empty pane is now kept too, one comment is reworded, and one timing window is written down), live check 6 of 6 on the fixed tree |

## Checks on the merged branch

All on `integrate/wave-2026-11-15` at `e1168c4d`, run by the coordinator alone with every builder pane idle.

| Check | Result |
|---|---|
| Whole page suite (`pnpm test`) | 935 files, 6,948 tests passed, 3.2 min |
| `pnpm check` (tsc, licences, plan, glossary, guide, workflows, invoke contract, kolux-memory tests) | exit 0 |
| `pnpm build` | exit 0 |
| Engine lint (`cargo clippy -j 6`) on the merged tree | exit 0. No Rust file changed after it |
| Engine tests, by name | 53 Discard and status tests passed in the plain shell and again under the project's scratch homes. The whole Rust suite was not run (wave rule) |
| Live check (`scripts/evidence/smoke.mjs`) in the scratch test app | flows 1, 2, 3, 4, 6, 7 pass (6/6), 5.2 min. Setup line: "1 shell pane shown, no empty pane left" |
| Live check flow 5 (sessions after a relaunch; report-only until T-184) | fails, as before the wave: `savedLayout` changes across the relaunch, 11 shells come back against 8 shown, 0 Claude panes against 2 |

The first live run, on `976afa9d`, passed 3 of 6. Flow 1 was a real fault (the leftover pane above); flows 6 and 7
failed only as a knock-on and passed when run alone. The runs after the fix, on the uncommitted tree and on
`e1168c4d`, passed 6 of 6. In flow 7 the line "12 sessions ... shows 11 panes" is as the script means it: one cell
holds two tabs, so 11 are on screen at once and the restart count of 12 is every pane.

Not run: `python scripts/token-report.py --write` (the end-of-wave step in `AGENTS.md`). The coordinator's permission
check refused it; the script reads the agent transcripts under the real `~/.claude` and `~/.codex`. It is Txais's to
run from `G:\Dev\kolux`.

## Calls made on Txais's behalf

Each of these is built. Each can be changed back; say which.

**Start form**

1. On a slow start the form asks anyway after 5 seconds. If the ask is switched off, it stays off.
2. A file handed to Kolux at start does not count as "the user already acted".
3. The first folder added after setup opens the form and starts nothing by itself.
4. Setup closed or skipped with a folder already on the list: the form opens, unless the ask is off or a pane or a
   form is already open.
5. Sessions started from the form fill a never-started "pick an agent" pane first, so none is left beside them.
   Growing the layout strip asks for those panes too, and "+" on a full grid that still has one opens the form.
6. A never-started pane with a typed task, name or prompt is left as it is and counts as taken.
7. A model an AI no longer offers: "<AI> no longer offers <model>. Pick another."
8. A search for agents that never answers ends after 10 seconds with a line on how to retry. After one good list,
   a later slow search no longer blocks Start; a yellow line says so.
9. Labels: New look "Start agents" and "Close the Start form"; Classic look keeps "New session" and "Choose what
   to run…".

**Discard (All Changes)**

10. Discard leaves a folder that has anything in it and names it. It never discards a whole folder or the whole
    repository at once: "Pick the files instead."
11. It never writes or deletes through a folder link and never deletes a file to make room.
12. A deleted file comes back only into an empty place. A file or link standing there is left, with "Use Unstage
    to keep that file, or move it away and discard again."
13. A link standing where a letter-case-only rename points is left, with "Remove the link by hand, then discard
    again."
14. A copied file shows as a new staged file, so the file it was copied from is never touched.
15. On Windows a row whose name ends in a dot or a space, or is not spelled the way the disk spells it, is left
    with a sentence saying why and what to do next.
16. Words: "Kolux left this as it is:" is yellow; "Could not discard" and "Commit failed:" are red; an empty
    Discard says "Nothing to discard."

**Projects and the sidebar**

17. Taking a project out of Kolux ends, counts and asks about only its own terminals. A project inside it that
    stays keeps its own.
18. Two projects on one repository: removing one leaves the other's terminals and folders alone, and a worktree
    both list stays open. The question says so only when something is kept.
19. The sidebar lists project folders only, no session rows (his own decision of 2026-11-12).
20. A folder where an agent finished unseen shows its name in bold. The dot is green when one agent has finished
    and none is working or needs you.
21. Each project's own folder shows in its own grid; clicking a pane's Find box brings the pane to the front.

**Keys**

22. The delete shortcut always asks. The "ask before deleting" setting governs the menu and buttons only.
23. Closing keys (Ctrl+W and the like) wait while a plain text field has focus, on every keyboard layout and on
    the number pad. A closing command picked from the palette still runs.

**Words and leftovers**

24. "Worktree" stays the one word; "Delete Workspace" is now "Delete worktree".
25. The agent status switch stays, named "Show what each agent is doing", with text on what goes dark.
26. "Restart terminals" is gone; one "End all" button.
27. The dead Source Control panel code and its styles are removed. Its Settings switch reads "Show the AI actions
    for Git".
28. The Agents rail's button says what the page beside it says.

**Left as it was, on purpose:** a worker clearing its pane key (B-19), N-10, `rusqlite` 0.43 held, D-08 kept as
built.

## Open

**Decisions that are Txais's** (none was taken in the wave):

- Landing `integrate/wave-2026-11-15` on `main` and pushing `kolux` to GitHub.
- A release. `TxaisX/kolux` is private, so the update feed answers 404 and installed copies get no update. Making
  it public again needs a secrets scan first.
- Uploading the PC-only branches of the public `vollyio` (10) and of `storaiq` (2).
- Merging the notes vault (4 clashing notes).
- The deny rule in `G:\Dev\kolux\.claude\settings.json`.
- Product question: a single agent started from the Start form defaults to "Same folder" and gets no worktree,
  while two or more each get one. Intended?
- Product question: "Open in" and "Resume" still take the first never-started pane even when a task was typed into
  it (older than this wave; the Start form no longer does). Should they leave such a pane alone too?

**Checks nobody has run in the live app** (each needs a person at the window):

- Ctrl+W inside a text field, the palette's search box and a terminal's Find box; whether WebView2 itself acts on
  Ctrl+W, Ctrl+Alt+W or Ctrl+Shift+Backspace when Kolux lets the key through.
- A late first-run answer while the Start form is open. (The first folder added after setup opening the Start form
  is now covered by the live check's setup step.)
- Narrow pane headers with six panes; the sidebar under status, pull request and flat grouping.
- With "Show what each agent is doing" off: does a permission prompt still turn the pane "Needs you".
- The Discard timing window of F98-01 on the page (closed in code on both sides, not reproduced live).
- The Start form and never-started panes (review 101's list; proven by unit tests, not live): a repository with a
  setup script, first folder, Start 2 agents in their own folders: no empty pane left; a task typed into an empty
  pane, then "+" and Start 1: the typed pane stays; 1 shell and 1 empty pane, pick 4 on the layout strip: the form
  asks 3 and the grid ends at 4 with none empty; 23 sessions and 1 empty pane: "+" opens the form, 1 starts, 2 is
  refused; Classic look: 2 empty panes, grow the strip by 2, Start: all 4 started; Classic look: rename an empty
  pane's tab, then Start 1 from the form: the named pane stays.
- The live-check lists at the end of reports 59, 61 to 64, 70 to 74, 79, 82 to 84, 86, 88, 90, 92, 94, 96, 98, 100
  to 102.

**Sessions after a relaunch** (live check flow 5): fails on the merged build and is report-only until T-184 is
ticked. The saved layout changes across the relaunch, 11 shells come back against 8 shown, 0 Claude panes against
2. Stale script or real fault: not known.

**Left open on purpose** (P3, or needs both sides): F90-02, F90-04; F84-1 to F84-6; R82-07; R83-06 to R83-08;
R61-04; rule B off Windows; the explicit-view limit; the P3 notes of reviews 92 to 102. Among them:

- Review 101, F5 (older, not confirmed): a new workspace with a saved default pane count above 1 opens that many
  empty panes; starting fewer sessions from the first-folder form leaves the rest empty. The default is 1.
- Review 101: `gridSheet(win)` was not checked.
- Review 102, N3 (not confirmed): the Start form checks the 24-pane limit before the launch's waits (new folders,
  a setup script) and places its sessions after them. If the empty pane it counted on is typed into, or taken by
  "Open in" or "Resume", in between, the grid can end at 25. The form stays up until the sessions land, so this is
  hard to hit. About 20 minutes plus a test.
- Review 102: no test covers the step that moves each Setup tab onto its agent's cell in an own-folder team Start
  (traced by the reviewer; it works).
- Older: starting an agent from a "pick an agent" pane's own Start button drops a tab name given to that pane.
- Older: a team launch that fails leaves its Setup tabs in the grid's first cell; a retry makes new folders and
  does not reuse them.
- Spec card TERM-001 still says the pane count "is clamped to 1..12"; the code's limit is 24. Not checked which is
  meant.
- R100-01 (older): a rename that changes only a folder's letter case, with its new half deleted by hand, is written
  and then deleted with no message, on a route no screen reaches. A second Discard brings it back.

**Still unassigned from the first audit** (list not re-checked): B-02, B-11, B-12, B-15, B-16, B-18, B-19, B-22,
B-24, B-25, B-26, N-04, N-07, N-08, N-10, F29, F32, F33, the R-03 wording, R54-06, the hook launcher that opens
windows (D-07's real fix), job 20's three old-code proofs, and the panel-only helper exports job 48 kept with their
tests.

## Notes for the next wave

- A fix lane that needs a fifth round has a wrong assumption, not a list of bugs. Name it and change the rule. Here
  the turn came when `one_entry` asked the disk (job 97) instead of comparing letters.
- Coordinator context: never read a whole brief, report or transcript over about 150 lines in one call. Search for
  the finding IDs and read ranges.
- Run the live check before the last review, not after it. This wave's first live run came after every lane was
  reviewed and merged, and it found a fault no review could see from the code (two panes shown at once).
- `scripts/prove/live-TERM-004.mjs` is stale and was not fixed.
- The guide check passes when a page's text has not changed since its marker commit. It does not notice that a
  listed source file changed, so a merge that changes behaviour needs a read of the pages by hand.
