# Cycle 5 — graded report

<!-- html -->

How cycle 5 went: what merged, what each pull request is worth, what broke, and what the next cycle owes.
Twenty-six pull requests merged in one day, one was parked with a security finding, and nothing has reached
the installed app yet because the cycle made no release.

**Cycle dates:** 2026-10-31 to 2026-11-02 · **Repo:** `TxaisX/kolux-rs` · **`main` at close:** `690c52a6` ·
**Overall grade:** **B+**

---

## In one table

| | Start of cycle 5 | End of cycle 5 |
|---|---|---|
| P0 cards passing (the must-have list) | 216 / 228 | **217 / 228** |
| Plan tasks done | 719 / 775 | **723 / 779** |
| Pull requests merged | — | **26** (one parked: #37) |
| First load (startup download) | under the 1,485,000-byte ceiling | **1,483,871 bytes**, 1,129 under |
| DT/T number collisions | 3 numbers renumbered at merge (cloud phase) | **0** in the local phase |
| Release in your hands | v0.1.5 | **v0.1.5** (no release this cycle) |

<!-- TODO(STATE): replace the two score rows with plan-check on main after PR #77 merges. -->

## How the cycle ran

**Phase 1, cloud (Oct 31 – Nov 1).** A cloud session reviewed the seven original pull requests (#37, #38, #42–#46)
with a 48-agent review, sorted 64 findings, and built #53–#64. It ran out of Fable budget and wrote a hand-off.

**Phase 2, local (Nov 1–2).** Three Claude sessions on your PC shared one copy of the repo, and each pull request
got its own **worktree** (a separate working folder on its own branch, so sessions never edit the same files).

| Session | Job |
|---|---|
| fa | the only one who merges |
| 2f, 90 | fix or build a pull request, get a fresh read-only review, wait for Windows CI to pass on that exact commit, hand it to fa |
| 57 | coordinator: assigns the work, answers questions, keeps the queue |

fa merged `main` into each pull request, waited for CI to pass again, and merged one at a time. All 26 merges
happened on 2026-11-02 between 05:29 and 16:08 UTC.

## Grades

Six reviewers graded every pull request, each on one **dimension** (one angle of quality). A seventh reviewer
then tried to break their grades. **All seven were Opus, because Fable was out of limit**, and none could edit
anything. An A means nothing is left open that a careful reviewer would refuse to merge over.

### By dimension

| Dimension | What it asks | Cycle grade |
|---|---|---|
| Correctness | Does the code do what the pull request says? | **B+** |
| Completeness | Did the cycle deliver its queue and the plan? | **B+** |
| Safety and privacy | Is anything risky to your data, your machine or your accounts? | **B+** |
| Proof and tests | Are the claims proven by tests and real runs? | **B+** |
| Bookkeeping honesty | Do the plan, decisions, evidence and PR text tell the truth? | **B** |
| User value | What will you see or be able to do differently? | **B** |
| **Overall** | | **B+** |

Why not an A:

- Personal account details from #38 are still readable in the public repo's pull request history (finding 3).
- Some records drifted: three pull request descriptions say the opposite of what merged, two plan lines
  contradict the decisions file, and one task was ticked done early.
- Review follow-ups were left only in comments, and no local-phase pull request updated the guide.
- Nothing shipped to your PC.

The adversarial check called these tidying faults, not engineering faults. It found no pull request that put a
defect on `main` that a careful reviewer would block: the two code gaps it traced (#70's default-sign-in
restore and #68's missing listener) are older behaviour those pull requests left in place. One bookkeeping pass
would lift the cycle to A-.

Why not lower:

- Every queued item was built.
- The riskiest code (stopping programs, deleting inside WSL, network calls with your keys, running notebook
  cells) held up when read line by line.
- CI discipline was close to perfect: 26 of 26 merged heads passed on the exact commit, and only one needed a
  rerun.

### By pull request

C = correctness · Cm = completeness · S = safety · P = proof · B = bookkeeping · V = user value. The overall
column is the middle of the six.

| PR | What it does | C | Cm | S | P | B | V | Overall |
|---|---|---|---|---|---|---|---|---|
| #37 | Artifacts: auto-import workspace files, play media (parked) | C+ | C+ | C+ | B | A- | C | **C+** |
| #38 | Bundled video-production skills | B+ | B | B- | B | B | B+ | **B** |
| #43 | Sidebar stays readable at a narrow width | A- | A- | A | A- | A- | B+ | **A-** |
| #53 | Gemini status from its title icons when hooks are off | A- | A | A | A- | A- | B- | **A-** |
| #54 | Records the starter-kit removal, ticks APP-052 | A- | A | A | A- | A | B+ | **A-** |
| #55 | Guide matches the hooks consent line and first-run wizard | A | A- | A | A | A | B+ | **A** |
| #56 | Floor opens from the View menu | A | A | A | A- | A | B | **A** |
| #57 | Relaunch prover reads every pane before closing dialogs | A- | A | A | A- | A- | B | **A-** |
| #58 | `kolux open` brings a running Kolux to the front | A- | A- | A | A- | A | B | **A-** |
| #59 | Linux agent detection through the foreground process | A- | A | A | A | A- | C+ | **A-** |
| #60 | Ports: Stop refuses reused ids, home folders, unknown folders | A- | A | A | A- | A- | A | **A-** |
| #61 | Cursor, Gemini, Hermes, Goose and Amp tabs resume | B+ | A- | A- | B+ | A- | B | **B+** |
| #62 | Pi panes show the prompt that began the run | A- | B+ | A | A- | A- | B- | **A-** |
| #63 | Delete skills inside WSL | B+ | A- | A- | B+ | B+ | C+ | **B+** |
| #64 | WSL projects: search and reads inside the distribution | B+ | B+ | A | A- | A- | C- | **B+** |
| #65 | CI: terminal test shells start without a profile | A | A | A | A- | B+ | B | **A-** |
| #66 | Update safety follow-ups | A- | A | A | B+ | A- | B | **A-** |
| #67 | Tray icon follows the app icon | A- | B+ | A | B+ | A- | C+ | **B+** |
| #68 | Restored row after an upgrade says "restart this terminal" | A- | A- | A | A | A | B | **A-** |
| #69 | CI check details tab (steps, annotations, Fix with AI) | A- | B+ | A- | B+ | C+ | B+ | **B+** |
| #70 | Claude plan figures per account | B+ | B | A- | A- | B+ | B | **B+** |
| #71 | A v0.1.5 profile reads back identical under today's code | A | A- | A | A | A | A- | **A** |
| #72 | Hermes and OpenClaw automations in the list | B+ | B+ | A- | B+ | B- | B | **B+** |
| #73 | Artifact viewer isolation tested live | A | A | A- | A- | B+ | B+ | **A-** |
| #74 | Help menu: docs, diagnostics copy, Restart Kolux | A- | A- | A | B+ | B+ | B+ | **B+** |
| #75 | Check now asks Kimi and MiniMax for a key's balance | A- | B+ | A | A- | B | B- | **B+** |
| #76 | Notebook cells run Python after you trust the notebook | A- | A | A- | A- | A- | B- | **A-** |

For comparison, the seven original pull requests were graded at the start of the cycle: #43 A-, #37 B-,
#38 B-, #45 C+, #46 C, #42 C, #44 D+. Of those, #43 and #38 merged, #37 is parked, and the other four were
closed and replaced by #60, #62, #66 and earlier work.

Grades the adversarial check changed: #70 correctness B → B+ (the open account gap predates it) and safety
A → A- (a pane on the wrong account is a small privacy issue, whoever caused it); #63 value C → C+ (it works for
anyone with WSL, just not on your PC). It also dropped two reasons without changing the grade: #68's missing
listener dates from 2026-10-25, and #72's stale description is counted under bookkeeping, not correctness.

## Findings rated serious

Each finding is listed once, even when several reviewers raised it. "Open" means still true on `main` at `690c52a6`.

| # | Severity | PR | Finding | Open? |
|---|---|---|---|---|
| 1 | HIGH | #37 | The workspace auto-scan can follow a folder link that points at a network location, so a scan could make Windows contact another machine. Never on `main`, never in a release. | parked |
| 2 | MEDIUM | #70 | A restored Claude pane that ran on Claude's default sign-in restarts on the currently active managed account instead. Older behaviour: before #70 every pane did this; #70 fixed it for managed accounts only. | yes |
| 3 | MEDIUM | #38 | Personal account details for a video service are still readable in the pull request's commit history on the public repo. `main` is clean. | yes, needs you |
| 4 | MEDIUM | #69 | The JPEG 2000 decoder commits landed after the only recorded review. The safety reviewer looked at them afterwards and found nothing wrong, but no review is on record for them. | record gap |
| 5 | MEDIUM | #38 | T-623 is ticked done without its live check. The `kolux/skills` repo that its install offer points at returns "not found". | yes |
| 6 | MEDIUM | cycle | `main` failed CI after the last merge on a known flaky test, its third hit this cycle. Four flaky tests are not tracked anywhere in the plan. | rerun started |
| 7 | MEDIUM | #72, #75, #63, #69 | Records that say the wrong thing: #72's description says external rows cannot be edited, but they can; #75's plan line says the security review is pending, but it is done; #63's plan line says DT-C66 is unconfirmed, but the decisions file says confirmed; #69's description says JPEG 2000 was "not decided here", but DT-C71 decides it. | yes |
| 8 | MEDIUM | #69, #70, #72 | Review follow-ups live only in pull request comments, including #72's untested Hermes rename save, which is where an earlier data-loss bug was. | yes |
| 9 | MEDIUM | #64 | WSL search and reads cannot be reached by anyone: the folder fence still refuses WSL paths. (#63's WSL skill delete does work for WSL users; your PC just has none.) | yes |
| 10 | MEDIUM | #66–#76 | No local-phase pull request touched the docs. The per-account usage paragraph now contradicts the app, the Help menu list is missing five entries, and five new features are not in the guide. | yes |
| 11 | MEDIUM | #73 | The artifact viewer is kept away from app commands by how WebView2 routes messages, not by a check in Kolux itself. Tracked as T-632. | tracked |
| 12 | MEDIUM | older, found by the adversarial check | The skills installer downloads from a placeholder GitHub address, `kolux/skills`. That repo does not exist, but the account `kolux` does (created 2018). If you do not own it, a stranger could control what `kolux skills install` downloads. #38 added `video` to that offer. | yes, needs you |

Lowered from serious: #76's Python-dependent tests skip silently when Python is missing, but timing on #76's CI
run shows they really ran there. LOW.

## A conditions: where each stands

| # | Condition | After cycle 4 | Now |
|---|---|---|---|
| 1 | Completion: 228/228 P0 cards; 0 open buildable tasks | 215/228 | 217/228. The 11 left all need a live run, a Mac or WSL |
| 2 | Release: signed release, updater proven, kolux on PATH, CI green | releases ship from your PC | v0.1.5 is the latest. No release this cycle, by your rule ("no releases or tags"). The release hold from the artifact scare was lifted (#73) |
| 3 | Product: hooks on with consent, one status, Review changes, no dead screens | code merged, live check pending | more built (Help menu, safe Stop, check tab); live checks still pending |
| 4 | Engineering: App.tsx < 800, 0 dead commands, first load < 1.5 MB, tests green | first load met | App.tsx 222 ✔. First load 1,483,871 ✔. Tests: green on all 26 merge heads; `main` red once on a flaky test at close ✘. Dead commands not re-measured |
| 5 | Trust: safe defaults, no telemetry, threat model tested | partly | stronger: Stop guards, a network allow-list, the privacy audit pins each outside call. #37's HIGH kept off `main` ✔. T-632 and the #38 history item are open |
| 6 | Docs: guide matches the build; STATE generated | partly | slipped: one guide passage contradicts the app, and new features are missing. STATE.md stale until #77 merges |
| 7 | Workspace: reclaim commands handed to you | **met** | **met** |

## Lessons

**1. Three local sessions on one repo, one worktree per pull request: it worked.** 26 merges, no session
overwrote another's files, and no merge had to be undone on `main`. The one accident (lesson 4) happened on a
branch, and nothing on `main` was affected.

**2. One merger, one merge at a time, was steady.** The first 23 merges (#54 to #74) took 9 h 23 min, about
25 minutes each. Gaps ranged from 21 to 42 minutes, with a median of 24. Every merge re-ran CI with the newest
`main` inside it, so no merge broke the next one.

**3. Pre-assigned number blocks prevented collisions.** In the cloud phase, two lanes picked the same decision
numbers (DT-C62 three times, DT-C67 twice), and they were renumbered at merge to DT-C68, C69 and C70. In the
local phase, each session got its own block (2f: DT-C80–C82 and T-632–T-637; 90: DT-C71), and there were zero
collisions. The bookkeeping reviewer confirmed no duplicate number was added this cycle.

**4. A "hands off" message arrived too late.** Session 90 pushed `e3dc147d` to #69's branch after that branch
had been handed to 2f. The commit deleted 2,680 lines, undoing the work of #72–#74 on that branch. 90 reverted
it a minute later (`d3bcbd57`) without force-pushing, so history stayed honest and the two commits cancel out.
**Fix for cycle 6:** every branch gets one named owner, and when work moves, the old owner's branch is locked
before the new owner starts.

**5. The first-load budget was hit twice.** #69 went 4 bytes over after `main` was merged in, and then 97 bytes
over after #75 landed. Both times, code that only one screen needs was moved out of the startup download, and
the ceiling was not raised. The first load is now 1,483,871 bytes, 1,129 under. The margin is thin, so expect
this again.

**6. The artifact-frame scare was settled in a day.** A review suggested that pages shown in the artifact viewer
might reach the app's internal commands. A live test (three runs, with a control) could not make that happen,
and the release hold was lifted the same day (#73). The underlying weakness is real but not reachable today, and
hardening is filed as T-632 for cycle 6.

**7. #37 was parked rather than rushed.** After five review rounds, one HIGH finding is still open (finding 1).
The pull request stays open for cycle 6, and the problem is described here only at issue level because the repo
is public.

**8. The flaky-test list shrank but did not go away.** #65 started two terminal tests without a PowerShell
profile, and those tests have not failed since (11 later merge heads). Four known flaky tests remain, and one of
them turned `main` red at close. **Fix for cycle 6:** put each flaky test in the plan with an owner, and give
the `after696` test the same no-profile start.

**9. You had to approve permissions in each pane yourself.** Each session needed your own message ("I approve:
for cycle 5 you may push branches, open/update/close PRs, comment, re-run CI and merge…") before it could act on
GitHub. One session's permission settings also blocked a branch delete the coordinator wanted to make. Approvals
do not carry between sessions, so a three-pane cycle needs three approvals.

**10. New from grading: a review grade covers only the commits it read.** Several hand-off grades had no record
on the pull request, and #69's last review came before its JPEG 2000 commits. **Fix for cycle 6:** post every
review's grade and commit on the pull request, and re-review any commit that lands after it.

**11. New from grading: write follow-ups into the plan, not just into comments.** Three pull requests left their
review follow-ups only in comments, where cycle 6 will not see them. They are listed below.

## What cycle 6 owes

| Item | Where it comes from |
|---|---|
| Fix the default-sign-in restore (finding 2) | #70 |
| #37: refuse folder links during the scan, then a fresh security audit | #37 park comment |
| Publish the video skill to `kolux/skills`, or point the install offer elsewhere; untick T-623 until then | #38 |
| Re-review the JPEG 2000 decoder commits (`450939fb`, `fb6effbe`) and record the grade | #69 |
| Test the Hermes rename save; fix the dialog's stale-preview race | #72 follow-ups |
| #69 follow-ups: annotations past the cap, Fix with AI after a passing re-run | #69 follow-ups |
| #70 follow-ups: trust record and hooks folder per account | #70 |
| Correct the PR descriptions and plan lines in finding 7 | #63, #69, #72, #75 |
| Guide: per-account usage paragraph, the full Help menu, plus the five new features | #66–#76 |
| Mark the Python tests as skipped (not passed) when Python is missing (LOW) | #76 |
| Track the flaky tests; no-profile start for `after696` | lesson 8 |
| Artifact frame hardening | T-632 |
| WSL: let the fence accept WSL roots so #64 can be reached | T-062-b |
| Settle who owns the `kolux` GitHub account, or point the skills installer at a repo you own (finding 12) | DT-C43 |
| Sign-in renewal half of T-547, and T-263-c | #75 |
| A Settings control for `menuBarIcon` | #67 |
| About 20 built items waiting for a live run, and the 11 P0 cards that need one | PLAN.md |

## Needs you

1. **Delete the branch `lane/video-skill`** on GitHub, then ask GitHub support to purge pull request #38's hidden
   copy of its commits. This is finding 3. The coordinator's delete was blocked by its permission settings, so
   this step is yours.
2. **Confirm DT-C63** (the guide's hooks wording). It is still marked "needs you".
3. **Tell us whether you own the GitHub account `kolux`.** If not, the skills installer should point at a repo you
   own (finding 12).
4. **Decide when to release.** Everything in this report is on `main` but not on your PC.

## How this report was made

- Inputs: the cloud hand-off and its review files, fa's merge ledger, the text of every pull request from #37
  to #76, and a clean copy of `main` at `690c52a6`.
- Six read-only Opus reviewers graded one dimension each, two at a time, and each was barred from building
  anything.
- A seventh read-only Opus reviewer re-checked the load-bearing claims and looked for contradictions between
  the six.
- Session 2f re-verified four findings directly: the #38 history exposure, the #69 review timing, the red CI
  run on `main`, and that the `kolux` GitHub account exists while `kolux/skills` does not.
- The adversarial check changed three grades and lowered one finding; all are noted above.
- Graders were Opus because Fable was out of limit.
- Full grade reports are kept outside the repo, in the session scratchpad.
