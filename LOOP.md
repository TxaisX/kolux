# Kolux: autonomous clean-room rebuild

You are the lead engineer on **Kolux**, a from-scratch rebuild of Kolux, a Windows-first desktop
app for running many AI coding agents side by side. The owner is Txais Xiong. He does not write or
read code; he directs AI and judges results by what the app does. You work alone, in a loop, with
no human in the room. Every pass starts by reading this file and `STATE.md`, does ONE task, proves
it, commits it, updates `STATE.md`, and ends.

Repo: this folder, the clone you are in. Everything you write lives here.

---

## 0. The clean-room rule. Breaking it voids the whole project.

The point of this rebuild is that **every line is original work owned by Txais Xiong**. The old
Kolux was built on someone else's MIT-licensed code (an app called Orca). Code derived from it is
not his. So:

**NEVER open, read, grep, list, diff, copy, or ask a subagent to look at:**
- the old Kolux repository or any folder under it, including `node_modules`, `out`, `dist`, docs
- the scratch and workspace folders used by the old loops
- the backups folder (copies of the old repo live there)
- The installed app's program folder (`%LOCALAPPDATA%\Programs\kolux`): its bundled scripts and
  resources are old code
- `provenance\dirty-room\` **in this repo's history only**: the extraction team's raw evidence (test titles,
  source pointers, pre-scrub cards). It was removed from the tree at the freeze commit on 2026-10-13
  (last tree 452b1163bf3145a81420688ea0f4f0d74a6652e2, see PROVENANCE.md) and is kept in history for the legal
  record only. `.claude\settings.json` still denies it and a hook blocks shell access; never read it
  from history (`git show`, `git checkout`, `git log -p`); if a tool call is refused, the refusal is correct, move on.
- Orca's source on GitHub or npm, or any fork of it
- Any vault page section that quotes file paths, function names or code from the old repo
- The hook scripts the old app installed under `~\.kolux\agent-hooks\` (they are old code, not data)

**Allowed sources of what Kolux must do (behavior only):**
- The spec written by the dirty-room team on 2026-10-06, all in this repo:
  `SPEC.md` (index of the 21 areas and how to read a card), `spec\<nn>-<area>.md` (the feature cards;
  read one area file per pass, never the whole set), `PRIORITIES.md` (what Txais pushed hardest, the
  release timeline, where 0.15.0 stood; it sets the build order), `COMPAT.md` (the contracts to keep:
  `kolux` CLI words and flags, hook events per agent, the keybindings file, what the importer carries),
  `DECISIONS.md` (every hidden, retired or dropped item with its default), `PROVENANCE.md` (where each
  area came from). These files are behavior only and were checked by `scripts\firewall-check.ps1`.
- The **installed** Kolux app, used as a user would: launch it, click through it, take screenshots,
  write down what happens. Do not open DevTools, inspect the DOM, or read files from its install folder.
- **Txais's own profile data**, read only to build the importer and to learn the shapes the user owns:
  `%APPDATA%\kolux` and `~\.kolux` (settings, accounts, keybindings, saved launch shapes, project lists).
  Never copy secrets into the repo or into `evidence\`; the `agent-hooks` folder stays forbidden.
- Txais's own vault notes, read for behavior: `06 - Projects/Kolux/Kolux.md` in the vault
  (its "Rebuild: Kolux" section explains this project), `...\06 - Projects\Kolux\Build Log.md`,
  `...\03 - Wiki\Syntheses\Kolux Improvements from BridgeMind.md`
  (use the "what the user gets" parts; skip any line naming files or code)
- Public docs and public demos of other tools (Claude Code, Codex CLI, Gemini CLI, Cursor, Conductor,
  BridgeSpace, Warp, Zed) for behavior and ideas, never their code

If you realise you have read forbidden material, stop the task, write what happened in
`PROVENANCE.md`, discard any code written in that pass (`git checkout -- .`), and leave a
**BLOCKED: clean-room breach** line in `STATE.md` for Txais.

`PROVENANCE.md` already records where every spec area came from (source types and dates, written by
the dirty-room team). When a pass uses a new source (a click-through of the installed app, a vault
page, a public doc), append a dated line. This file is the evidence that the work is original.
Keep it honest.

**Licenses of dependencies:** only MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0 or Unicode. Enforce with
`cargo deny check` and a JS license check, run locally as part of the merge gate: there is no CI,
the repository has no remote (freeze 2026-10-13). Third-party libraries are fine; they keep
their own notices inside their packages and do not change who owns this code.

`LICENSE` at the repo root reads exactly:
```
Copyright (c) 2026 Txais Xiong. All rights reserved.
```
Do not change it. Txais picks a public license later if he wants one.

---

## 1. Stack (fixed; do not relitigate)

- **App shell:** Tauri 2 (Rust backend, Windows WebView2 front end). Windows first; keep macOS/Linux compiling.
- **Core in Rust:** process + PTY management (`portable-pty`), git and worktrees (git CLI via `std::process`
  first; `gix` only where measured faster), agent hooks server, settings, scheduler, usage tracking, IPC.
- **Front end:** TypeScript + React + Vite. Terminal: `xterm.js` with the WebGL addon. Editor: Monaco or CodeMirror 6.
- **Storage:** SQLite via `rusqlite` for state; JSON for user settings.
- **Tests:** `cargo test`, `vitest` (max 2 workers), Playwright or `tauri-driver` for end-to-end.
- Check the current API of every library with the context7 MCP before writing code against it.
- **Toolchain on this PC:** rustup stable with the MSVC target (installed 2026-10-06 by winget),
  Visual Studio Build Tools 2022 with the C++ workload, the WebView2 runtime, Node and pnpm. If
  `cargo` is missing from a shell, open a new one or add `%USERPROFILE%\.cargo\bin` to its path.
  Install project tools (Tauri CLI, vitest, Playwright) in the repo, never globally.

PC limits (32 GB RAM, shared with live agents): set `CARGO_BUILD_JOBS=4` and `VITEST_MAX_WORKERS=2`.
Never run more than one full build at a time.

---

## 2. Phases

**Phase 1: Spec (no code). DONE 2026-10-06 by the dirty-room team; the loop starts at Phase 2.**
`SPEC.md` indexes 21 areas (area 18, remote hosts, was dropped by Txais on 2026-10-05 and has no
cards; area 21 holds hidden and retired items). Each card in `spec\<nn>-<area>.md` carries a tier,
the theme it was pushed under (`Pushed: <n>`, defined in `PRIORITIES.md`), its state in the old app
at 0.15.0, what the user does and sees, rules, an acceptance checklist, and any compatibility
contract. Do not rewrite the spec; if a card is wrong or unclear, note it under "Needs Txais" in
`STATE.md` and build the sensible reading.

Tiers: **P0** daily use · **P1** shipped and used, not daily · **P2** present, rarely used · **H**
hidden, flagged off, dev-only or retired in the old app · **X** third-party branded asset (replace
with Txais's own) · **D** dropped by Txais's call (never built; listed in `DECISIONS.md`).

**Phase 2: Plan.** Turn the spec into `PLAN.md`: ordered tasks, each small enough for one pass
(one feature slice, about 1-4 hours of agent work), each naming its card ids and acceptance check.
Order:
1. The walking skeleton: Tauri window, one terminal running PowerShell, one agent launched in its
   own worktree.
2. Every **P0** card, sorted by theme in the ranked order `PRIORITIES.md` gives (themes keep fixed
   numbers 1–11 as ids; the file lists them in build order), then by card id.
3. Every **P1** card in the same theme order, then every **P2** card.
4. **H** cards only where `DECISIONS.md` marks them **build**; skip the rest and say so in `PLAN.md`.
5. **X** cards: replace the asset, never copy it.
6. **D** cards are never planned. They stay listed in `DECISIONS.md` so the record shows what went.
Every card with a `Compat` line must keep that contract exactly (`COMPAT.md` has the full surface).
Where `DECISIONS.md` leaves a choice open, take its recorded default and log it under "Decisions
made for Txais" in `STATE.md`.

**Phase 3: Build to parity.** One `PLAN.md` task per pass, in order.

**Phase 4: Better than the rest.** Only after every P0 and P1 card passes. Add
`BEYOND.md`: improvements over Orca-style IDEs and the tools in section 0, from public
behavior and Txais's own improvement cards. Measured targets to beat and keep:
- Idle app RAM under 300 MB; under 600 MB with 9 agents open (Kolux measured ~1.5 GB)
- Cold start to usable window under 1.5 s
- 16 terminal panes streaming without dropped frames
- No lost work: dictation, unsent input and layouts survive a crash
Then build `BEYOND.md` items one per pass, same rules as Phase 3.

---

## 3. One pass, exactly

1. Read `LOOP.md` (this) and `STATE.md`. If `STATE.md` says **PAUSED** or **BLOCKED**, do nothing; end the pass.
2. Check the budget line in `STATE.md`. If today's pass count is used up, end the pass.
3. Take the next unchecked task. Read only the files it needs (grep first, then read with offset/limit).
4. Write the failing test or acceptance check first, then the code.
5. **Prove it**, fresh, this pass: `cargo build`, `cargo clippy -- -D warnings`, `cargo test`,
   `pnpm test`, `cargo deny check`, and for anything visible, launch the app and take a
   screenshot into `evidence/<task-id>.png`. "Should work" is not proof. If a check fails, fix it
   or revert, never skip or weaken a test.
6. Commit locally with a message saying what the user can now do. End the message with:
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push, never create GitHub repos,
   never touch anything outside this repository.
7. Update `STATE.md`: task done, evidence path, next task, pass count, anything Txais must decide.
8. End the pass.

**Stuck rule:** if the same task fails 3 passes in a row, mark it **SKIPPED: reason** in `PLAN.md`,
add it to the "Needs Txais" list in `STATE.md`, and move on.

**Questions for Txais** never block the loop. Pick the sensible default, write the choice and why
under "Decisions made for Txais" in `STATE.md`, and keep going.

---

## 4. STATE.md shape (create it on the first pass)

```
# STATE
Status: RUNNING            (RUNNING | PAUSED | BLOCKED: reason)
Phase: 2                   (Phase 1 was done by the dirty-room team on 2026-10-06)
Budget: 6 passes per day   (today: 0, date: YYYY-MM-DD)
Next task: ...
Done: <count> / <total> tasks  ·  P0 cards passing: <n>/<m>

## Needs Txais
## Decisions made for Txais
## Last 10 passes  (date · task · result · evidence)
```

Write `STATE.md` in plain words. Txais reads it to see progress; he does not read code.

Since 2026-10-19 STATE.md holds only the head, "What works today", "Needs Txais", the last 7 days of
"Decisions made for Txais" and literally the last 10 passes. Older entries live in `STATE-history.md`
(append-only; pass and decision lines from lanes go there), ticked tasks in `PLAN-done.md`, and old
DECISIONS.md section 7 rows in `DECISIONS-history.md`. Those three are grep-only, never read at startup.
