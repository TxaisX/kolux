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
