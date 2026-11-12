# LANE-REPORT — o1-tools (fast local builds, tool screens)

## Status (plain words)

Round 1, audit only: nothing was changed, so nothing new works yet. The audit is written and
committed, and every cross-lane part of the web-pane removal is now in the owning lane's bug
queue. The one number that matters: a local "try my change" build costs 20 minutes of Rust
compile time because the release profile uses full LTO.

## Done this round (audit only — no code changes)

1. **Read the briefs and merged.** `git merge --no-edit integrate/wave-1` → `Already up to date`.
   Bug queue had one item (`20261112-1102-outbound-browser-pane-rows.md`, settings privacy text) — noted in the audit as N-40/T-1.
2. **Goal 0 inventory, complete.** `AUDIT-o1-tools.md` section 1 (from the earlier pass) plus my
   section 4 lists every user of the embedded browser with an owner: 27 Rust modules (14,847
   lines), 81 TS files (7,534), 98 CLI commands, ~28 Tauri commands, 8 feature cards, 5 doc pages,
   1 spec, 2 settings switches, and 5 places one link-routing rule is read.
3. **The P0 nobody had spotted:** the update check calls `crate::browser::head(...)`
   (`src-tauri/src/update.rs:163`). Deleting `browser*` as-is silently removes the app's ability
   to update. Project icons (`web_icon.rs`) and the Tower window (`browser_tower.rs:45`) are the
   same class of problem. Filed to c3-terminal with the safe cut described.
4. **Measured the slow loop** (the numbers the local build has to beat), all on this PC:

   | Command | Time |
   |---|---|
   | `pnpm install --prefer-offline` | 0.8 s (`Done in 24ms`) |
   | `pnpm build` (tsc + vite) | 31 s (`✓ built in 5.12s`) |
   | `cargo build` debug, app crate, warm target | **2 m 42 s** (`Finished dev profile … in 2m 42s`) |
   | `cargo build --release`, app crate, deps cached | **19 m 55 s** (`Finished release profile [optimized] target(s) in 19m 55s`) |

   Cause: `[profile.release]` in `src-tauri/Cargo.toml` is `lto = true` + `codegen-units = 1`
   on one 168k-line crate. Same crate, same machine: release costs 7x debug. Filed to c3-terminal
   as a 20-line `[profile.local]` request.
5. **Audited my screens.** 43 new findings in `AUDIT-o1-tools.md` section 4 (1 P0, 7 P1, 15 P2,
   20 P3), each with file:line, CONFIRMED/PLAUSIBLE, fix and cost. The ones that matter most:
   the Checks-panel PR link and the Ports "Open" button become silent no-ops when the pane goes
   (P1), chat's link flow is the piece that stops the deletion from compiling (P1), every open
   editor tab runs a 2 s `file_stamps` poll through the worktree-fence mutex (P2), and right-click
   gives no menu at all on non-editable text, so there is no right-click Copy in the app (P2).
6. **Bug files filed** (3 new; the rest of the cross-lane work was already in the 11:05 batch):
   - `_shared/bugs/c3-terminal/20261112-1143-browser-net-helpers-must-survive.md` (P0)
   - `_shared/bugs/c3-terminal/20261112-1144-add-a-local-build-profile.md` (P1)
   - `_shared/bugs/c3-terminal/20261112-1147-right-sidebar-polls-behind-settings.md` (P3)

**Proof (fresh run this round):** `pnpm build` → exit 0 in 31 s; its `tsc` half is the TypeScript
gate (`npx tsc --noEmit` is the same compiler pass) and it emitted only the known
`INEFFECTIVE_DYNAMIC_IMPORT` warning on `src/editor/EditorPane.tsx`. No vitest run this round:
no code changed, and the earlier pass already recorded the two editor tests that flake under
parallel CPU load (`richSaveLists.test.ts:55`, `PreviewPane.test.ts:86`, both pass alone).

## Next round (top 3)

1. **Delete the web pane, my half**, in the order given in `AUDIT-o1-tools.md` 4.9: move
   `notePdf.ts` to `editor/`, add `src/open/openExternal.ts`, repoint Checks / Ports / HTML
   preview / chat links, delete the two settings switches, then delete `src/browser/` and its 8
   feature cards in one commit. Blocked until c3-terminal lands the Rust cut, so start with the
   repointing (compiles either way).
2. **`pnpm local` + `docs/dev-loop.md`**: `scripts/local-run.mjs` (`tauri build --no-bundle
   --profile local --config local.json`, identifier `com.txaisxiong.kolux.local`), shared
   `CARGO_TARGET_DIR`, then one timed run proving the before/after. Needs c3's `[profile.local]`.
3. **The three worst live bugs in my area that do not wait on the removal**: the 2 s per-tab
   `file_stamps` poll (N-03), the Checks-create block frozen on a single status read (N-16), and
   no right-click Copy anywhere (N-07). Then delete the dead 1,367-line `SourceControlPanel.tsx`
   (F-09, coordinator confirmed it has no production importer).

## For the coordinator

**CHANGELOG lines (round 2, once the removal ships):**
- "Web pages now open in your own browser. Kolux no longer draws web pages itself, which uses far
  less memory and lets you run more agents at once."
- "A local build command can now build and start Kolux in a few minutes, without an installer and
  without touching your installed copy."

**DECISIONS row requested:** remove the embedded browser to cut resource use; links open in the
system browser; native terminals are the focus. Evidence: `docs/research/kolux-slimdown-2026-11-09.md`
(web view ≈ 509 MB across 6 processes).

**Decision requested:** after `src/browser/` is deleted, five of my files need a shared "open in
the system browser" helper. I propose a new `src/open/openExternal.ts` owned by o1-tools for this
wave — one wrapper around the existing `open_external` command
(`src-tauri/src/artifacts.rs:1405`). Say so if you would rather it sit somewhere neutral.

**Cross-lane asks already filed** (no action from you unless routing is wrong):
- c3-terminal: keep a `net.rs` slice of `browser.rs` (update check + project icons), move
  `tower_window_open` out, add `[profile.local]`, fix `Right.tsx:62`.
- The 11:05 batch already filed the broad removal work to c3-terminal, c2-agents, o2-tests,
  o3-rune and you. My 11:43 batch adds only what was missing.

**One thing outside the repo, for Txais:** `~/.claude/skills/kolux-cli/SKILL.md:5,8` still
promises "Kolux's embedded browser through the `kolux` CLI". One-line edit in claude-config; no
lane owns that file.
