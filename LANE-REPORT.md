# Lane o1-tools — Round 1 Report

## Status
Round 1 audit complete (no code changes made). Inventoried every embedded-browser dependency across the entire repo and filed Goal 0 bugs to all 5 other lanes (`c3-terminal`, `c2-agents`, `o2-tests`, `o3-rune`, `c1-coord`). Identified the slow-build causes (missing shared `CARGO_TARGET_DIR`, fat LTO release profile, 30-minute GitHub CI gate in `scripts/release.mjs`), plus 19 audit findings across `o1-tools` modules.

## Done this round
- Completed Goal 0 embedded-browser inventory across `src/`, `src-tauri/`, `scripts/`, `docs/`, and installed skills; recorded full owner table in `AUDIT-o1-tools.md` and filed 5 bug files:
  - `G:\Dev\kolux-lanes\_shared\bugs\c3-terminal\20261112-1105-remove-embedded-browser-backend-and-shell.md`
  - `G:\Dev\kolux-lanes\_shared\bugs\c2-agents\20261112-1105-remove-embedded-browser-onboarding-and-panes.md`
  - `G:\Dev\kolux-lanes\_shared\bugs\o2-tests\20261112-1105-remove-embedded-browser-proofs-and-stress.md`
  - `G:\Dev\kolux-lanes\_shared\bugs\o3-rune\20261112-1105-remove-embedded-browser-status-refs.md`
  - `G:\Dev\kolux-lanes\_shared\bugs\c1-coord\20261112-1105-remove-embedded-browser-docs-decisions-gates.md`
- Measured baseline build/check/test timings:
  - `pnpm install` (warm): `0.62s` (missing `node_modules`: `2.8s`)
  - `npx tsc --noEmit`: exit 0 (`19.43s`)
  - `npx vite build`: exit 0 (`9.68s`, flagged `INEFFECTIVE_DYNAMIC_IMPORT` on `src/editor/EditorPane.tsx`)
  - `pnpm check`: exit 0 (`license-check: OK`, `plan-check: OK`, `glossary-check: OK (61 UI labels have an entry; 5 unused terms are gone)`, `guide-check: OK`, `workflow-check: OK`, `invoke-contract: OK (806 invoke calls by name against 481 registered commands)`, `5 pass` in `tools/kolux-memory/test.mjs`)
  - `npx vitest run src/settings src/editmenu src/ports src/artifacts src/automations`: `Test Files  124 passed (124)`, `Tests  735 passed (735)` (`48.03s`)
  - `npx vitest run src/scm src/skills src/chat`: `Test Files  83 passed (83)`, `Tests  808 passed (808)` (`29.01s`)
  - `npx vitest run src/browser`: `Test Files  43 passed (43)`, `Tests  290 passed (290)` (`18.88s`)
  - `npx vitest run src/editor`: `109 passed, 2 failed` under parallel load (`richSaveLists.test.ts:55` and `PreviewPane.test.ts:86`); re-run alone `npx vitest run src/editor/richSaveLists.test.ts src/editor/PreviewPane.test.ts`: `Test Files  2 passed (2)`, `Tests  17 passed (17)` (`8.33s`)
- Wrote `AUDIT-o1-tools.md` covering Goal 0, fast local loop, and 19 findings (F-01 through F-19).

## Next round
1. Remove `src/browser/` (extracting `notePdf.ts` + `notePdf.test.ts` to `src/editor/` first for Markdown PDF export `EDIT-018`) and rewire `PortsItem`, `htmlPreview`, `ChecksPanel`, `ChatView`/`ChatText`, and `Settings` links/shortcuts to open URLs in the system browser (`open_external`).
2. Build `pnpm local` (`scripts/local-run.mjs`) + `docs/dev-loop.md` using a shared `CARGO_TARGET_DIR` and `com.txaisxiong.kolux.local` identifier, with measured before/after timings.
3. Walk owned screens in the live harness against `docs/guide/feature-index.md`, then fix audit findings (`EditorPane.tsx` circular/static imports causing `INEFFECTIVE_DYNAMIC_IMPORT`, `Explorer.tsx` split & Windows `relative()` case fix, dead `pickers.ts`, shadowed CSS in `settings.css`, missing tests).

## For the coordinator
- **Goal 0 DECISIONS row & CHANGELOG line (needed in Round 2):** Filed `_shared/bugs/c1-coord/20261112-1105-remove-embedded-browser-docs-decisions-gates.md`. Please confirm a `DECISIONS.md` row retiring the embedded browser pane (superseding OD-18 and BROW-*), a plain-words `CHANGELOG.md` line ("Kolux no longer includes an embedded browser pane; web links open in your default browser instead"), and updating `scripts/glossary-check.mjs` (`Tab` entry) + `scripts/privacy-audit.test.mjs` (`browser.rs` rules) once `src/browser/` and `src-tauri/src/browser.rs` are removed.
- **Important cross-lane keep-list for Goal 0 (`c3-terminal`):** When `c3-terminal` removes `src-tauri/src/browser*.rs`, `browser_pdf.rs` (Markdown PDF export `EDIT-018`), `browser_tower.rs` (Tower window), `browser_preview.rs` (local HTML loopback preview `EDIT-025`), `web_icon.rs`'s `local_host`/`allowed`/`icon_client_for` helpers, and `webview2-com` (`edit_menu.rs`, `webview_power.rs`) must be preserved or extracted.
- **Dead-code decision request (`src/scm/SourceControlPanel.tsx`):** `SourceControlPanel.tsx` (1,350 lines) and `LineNotes.tsx`, `FailureNotice.tsx`, `FileOpenWith.tsx`, `openWith.ts`, `HandoffNote.tsx`, `LocalOnlyBadge.tsx` have zero production callers since T-644 (`DT-C85`), and lane E's auto-PR work is now shipped. Confirm whether Round 2 may delete those unmounted `src/scm/` UI files while keeping `ChecksPanel`, `CheckPane`, `AutoPrStatus`, `model.ts`, `checks.ts`, `autoPr.ts`, `oneClick.ts`, `changesActions.ts`, etc.

---

# Second pass — same round, 2026-11-12 11:43 (measurements, hazards, 43 more findings)

The same round run again in a fresh session: nothing above was thrown away, this is what the
second pass added on top. No code changes either.

## Status (plain words)

Round 1, audit only, two passes. The inventory, the filed bugs and the test-run proof from the
first pass all stand. The second pass found the one bug that would have been expensive: the
update check depends on a function that lives inside the browser modules, so deleting them as-is
silently ends updates. It also produced the hard numbers for the slow build.

## Measured this pass (quoted commands, this PC)

| Command | Time |
|---|---|
| `pnpm install --prefer-offline` | 0.8 s (`Done in 24ms`) |
| `pnpm build` (tsc + vite) | 31 s, exit 0 (`✓ built in 5.12s`) |
| `cargo build --manifest-path src-tauri/Cargo.toml`, app crate, warm target in `G:\Dev\kolux` | **2 m 42 s** (`Finished dev profile [unoptimized + debuginfo] target(s) in 2m 42s`) |
| `cargo build --release --manifest-path src-tauri/Cargo.toml` in `~/.kolux-rs/release-checkout`, deps already compiled | **19 m 55 s** (`Finished release profile [optimized] target(s) in 19m 55s`) |

Same crate, same machine: **release costs 7x debug**, because `[profile.release]` is
`lto = true` + `codegen-units = 1` on one 168k-line crate (210 files). That is ~95% of the
30-45 minutes a local try costs. Target dirs on disk: `G:\Dev\kolux\src-tauri\target` 56 GB,
release checkout 4.3 GB, this worktree none.

## What the second pass added

- **`AUDIT-o1-tools.md` section 4** (appended, nothing above rewritten): the measurement table,
  five local-loop findings (L-1..L-5, the `[profile.local]` one being the lever), five Rust
  removal hazards (H-1..H-5), and 43 findings numbered N-01..N-43 across editor/editmenu, scm,
  ports, artifacts, chat, skills, automations and settings — each with file:line,
  CONFIRMED/PLAUSIBLE, fix and cost.
- **The P0 neither pass had:** the update check calls `crate::browser::head(...)`
  (`src-tauri/src/update.rs:163`); project icons (`web_icon.rs:46,81-94`) and the Tower window
  (`browser_tower.rs:45`) are the same class. The first pass's keep-list named
  `browser_pdf.rs`, `browser_tower.rs`, `browser_preview.rs` and the `web_icon` helpers but not
  the HTTP client the updater uses.
- **Three new bug files** (the 11:05 batch already covered the broad removal work):
  - `_shared/bugs/c3-terminal/20261112-1143-browser-net-helpers-must-survive.md` — P0, the
    `net.rs` slice (HTTP client + URL policy) that must outlive the pane.
  - `_shared/bugs/c3-terminal/20261112-1144-add-a-local-build-profile.md` — P1/P2, the
    20-line `[profile.local]` that makes `pnpm local` possible.
  - `_shared/bugs/c3-terminal/20261112-1147-right-sidebar-polls-behind-settings.md` — P3,
    `Right.tsx:62` ignores `fullPage`, so the right panel keeps polling behind Settings.
- **Notes on two files I overwrote by accident and restored:** `AUDIT-o1-tools.md` and this
  report are the first pass's text plus my appended section. If a third session picks this
  worktree up: append, never overwrite (there are two sessions per lane worktree — see
  `_shared/bugs/c1-coord/20261112-1118-two-sessions-one-lane-worktree.md`).

## The worst findings, in plain words

1. When the pane is deleted, clicking a pull-request link in Checks, or Open in Ports, will do
   **nothing at all** — no tab, no error. Both already have a system-browser path one line away.
2. Chat's link handling is the piece that stops the pane deletion from compiling: one setting is
   read five different ways across four folders.
3. Every open editor tab re-checks its file on disk every 2 seconds, and each check lists
   worktrees under a shared lock while an agent is writing files.
4. Right-click anywhere on text that is not an input shows **no menu at all**, so there is no
   right-click Copy in the preview, the chat, the diff cards or the PDF view.

## Settings pass (appended after the commit below)

A dedicated pass over `src/settings/` found a P1 the whole wave had missed: **Settings >
Terminal > "Removing a started session" does nothing.** The control writes a key whose only
reader, `removePlan` (`src/terminal/remove.ts:41`), has no non-test callers; the live path
(`src/terminal/paneActions.ts:112`) always asks. Filed to c3-terminal with a choice: wire it or
tell me to delete the control. Nine more settings findings (search mounts every matched page in
full, the branch-prefix field calls the back end per keystroke, two duplicate number-field
widgets, four saves that skip the shared turn, five dead exports, four untested pages) are in
`AUDIT-o1-tools.md` section 4.11, N-44..N-53.

## Next round (top 3, in this order)

1. Delete the web pane, my half: move `notePdf.ts` to `editor/`, add `src/open/openExternal.ts`,
   repoint Checks / Ports / HTML preview / chat links, delete the two settings switches, then
   delete `src/browser/` and its 8 cards in one commit. The repointing compiles either way, so it
   does not wait on c3-terminal's Rust cut.
2. `pnpm local` + `docs/dev-loop.md`: `scripts/local-run.mjs` (`tauri build --no-bundle
   --profile local --config local.json`, identifier `com.txaisxiong.kolux.local`), a shared
   `CARGO_TARGET_DIR`, and one timed run proving the before/after.
3. The three worst live bugs that do not wait on the removal: the 2 s per-tab poll (N-03), the
   Checks-create block frozen on a single status read (N-16), no right-click Copy (N-07). Then
   delete the dead 1,367-line `SourceControlPanel.tsx` (F-09, already confirmed no production
   importer).

## For the coordinator (additions to the first pass's asks)

- **CHANGELOG lines (round 2, when the removal ships):**
  - "Web pages now open in your own browser. Kolux no longer draws web pages itself, which uses
    far less memory and lets you run more agents at once."
  - "A local build command builds and starts Kolux in a few minutes, with no installer and
    without touching your installed copy."
- **DECISIONS row requested:** remove the embedded browser to cut resource use; links open in the
  system browser; native terminals are the focus. Evidence:
  `docs/research/kolux-slimdown-2026-11-09.md` (web view ≈ 509 MB across 6 processes).
- **Decision requested:** after `src/browser/` is deleted, five of my files need one shared "open
  in the system browser" helper. I propose a new `src/open/openExternal.ts` owned by o1-tools for
  this wave — one wrapper around the existing `open_external`
  (`src-tauri/src/artifacts.rs:1405`). Say so if you would rather it sit somewhere neutral.
- **One thing outside the repo, for Txais:** `~/.claude/skills/kolux-cli/SKILL.md:5,8` still
  promises "Kolux's embedded browser through the `kolux` CLI". One-line edit in claude-config; no
  lane owns that file.
