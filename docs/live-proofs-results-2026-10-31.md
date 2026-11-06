# Live proofs on Windows — results of the first real run (2026-10-31)

This is `docs/live-proofs-windows.md` filled in from an actual run, not a plan. The difference this
time: the previous cycles were run by agents on a cloud machine that could not touch this PC, so
every cycle ended with "the 20 open P0 cards need a run on your Windows PC". This run used that PC.

How it was run: `scripts/prove/live-installed.mjs` launches the **installed** release build
(0.1.2) under a throwaway home, so a "profile that has never run Kolux" is real without
uninstalling anything, and drives its own WebView2 over the debugging port. Named checks live in
`scripts/prove/live-checks.mjs`. Raw evidence: `evidence/live-installed-2026-10-31.txt`.

## Results so far

| Item | Card / task | Result | Evidence |
|---|---|---|---|
| A-2 | T-608, consent line for status hooks | **PASS** — the line is on the first-run Status step, the switch starts on, and Claude's settings file gains Kolux's hook entries only after Done | `.onb-ping` switch `checked=true`; hooks in the scratch `settings.json` |
| B-1 | VIEW-002 box 1, the screen chord | **PASS** — Ctrl+Alt+V went Agents → Board → Terminals → Tower → Agents, twice | card box ticked; P0 count 208 → 209 |
| C-13 (box 1) | APP-070, no telemetry | **PASS so far** — a normal session's only non-loopback connections came from `msedgewebview2.exe` (the WebView2 runtime the Privacy page names); `kolux-rs.exe` held only loopback connections | 3-minute session watch, endpoints listed in the evidence |
| A-1 | T-594, kolux on PATH | **PASS on 0.1.3** — the installer left the 1,815-character Path alone, the app added `<install>\bin` once at its next start, no earlier entry was lost, a new terminal resolved `kolux` to 0.1.3, and a second install over the top did not double the entry. On 0.1.2 it failed exactly as predicted. | `evidence/live-A-1-T-594.txt` |
| — | Release feed | **PASS** — 0.1.2 is public, signed, and `latest.json` points at the GitHub-stored installer name (the dots fix) | `gh release view`, manifest |

## Update proofs: the precondition D-2 and D-4 both need

Attempted on 2026-10-31 with 0.1.3 installed: running the 0.1.2 installer with `/S` over 0.1.3 does
**not** install — no setup process is left, no error is shown, and the installed version stays 0.1.3
(the app was closed first, so it was not a running-copy refusal). The run list's own setup line says
"uninstall Kolux first if you skipped D-1", and that is the reason: an NSIS install cannot step down
a version in place.

So D-1, D-2 and D-3 are one sequence, not three:

1. **D-1** uninstall 0.1.3 (`/S`), then check the saved Path lost exactly the Kolux entry and the app
   is gone;
2. install **0.1.2**, start it, wait for the "is ready / Restart to update" line (the check runs at
   start-up), then quit the ordinary way;
3. **D-2** relaunch and check Help > About shows 0.1.3; **D-3** check the same projects, layout and
   settings came back.

D-4 is the same setup with "Restart to update" clicked instead of quitting. It needs a second update
cycle (install 0.1.2 again), so run it after D-2. Do the whole sequence in one sitting with the app
closed, and put the machine back on the newest release at the end.

## What also turned up

- **Three dead Path entries** from the old app still sit on the saved user Path, pointing at folders
  that no longer exist (`...\Programs\kolux\resources\bin` and two `G:\Dev\kolux-workspaces\...`
  copies). They keep the Path above the 1,024-character installer limit. Removing them belongs to
  the reclaim step and is Txais's call.
- **The installed 0.1.2 predates cycle 2.** The PATH fix (PR #19), the delete-safety work (PR #21)
  and the App split (PR #22) are all on main but not in the build on this PC. The next release
  carries them.

## Still to run (blocked, in order)

Everything below needs the PC, and most of it needs the app closed or a real install:

1. **Part B on the running app** — B-2, B-3 (palette rows and commands), B-4 (Escape), B-5
   (`kolux open`), B-7 (broken certificate), B-9 (three relaunches: APP-052 marker, T-566 restored
   chip, T-612 Tip).
2. **Part C with an agent** — C-1 (Ctrl+J), C-2 (hand-started Claude needs you everywhere), C-3
   (Review changes), C-4 (Pair handoff notes), C-5 (force-push ask), C-6 (stopped sub-agent),
   C-7 (closed tab status), C-8 (empty Stop list).
3. **Part D install, update, restart** — A-1 and D-1 on the next installer, then D-2/D-3/D-4 with
   0.1.1 → 0.1.3 (both installers are already downloaded to `G:/Temp/installers`).
4. **Part A's Codex and Gemini items** (A-4, A-5) — these need those CLIs signed in.

## Not runnable, and why (unchanged)

- APP-059 box 1 and APP-060 box 1: CI is not used (DT-C54), so these are not applicable.
- CLI-007 box 2: needs an older `kolux` registered machine-wide; the old app is gone.
- EDIT-053 box 2: needs Linux. TERM-030 box 2 (Mac half): needs a Mac.
- USAGE-021 box 3: Kolux asks no usage service today (DT-C14); waits on T-547.
- TERM-068 box 2 and SAFE-004 box 3: no way to cause the condition by hand. TERM-068 needs a code
  change first (the Edit-menu paste path has no such check).
- T-592's safe-graphics restarts: only reachable after a graphics crash.
