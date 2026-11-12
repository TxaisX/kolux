# Audit — Lane o1-tools (Round 1)

Date: 2026-11-12
Scope: Fast local build/run loop (`package.json` scripts, new `scripts/local-*.mjs`, `docs/dev-loop.md`), Goal 0 (remove embedded web pane), and owned modules (`src/settings/`, `src/editor/`, `src/editmenu/`, `src/browser/`, `src/scm/`, `src/ports/`, `src/artifacts/`, `src/automations/`, `src/skills/`, `src/chat/`).

Baseline checks run this round:
- `npx tsc --noEmit`: PASS (0 errors, 19.43s)
- `npx vite build`: PASS (9.68s; emits `INEFFECTIVE_DYNAMIC_IMPORT` warning on `src/editor/EditorPane.tsx`)
- `pnpm check`: PASS (`license-check`, `plan-check`, `glossary-check`, `guide-check`, `workflow-check`, `invoke-contract`, `kolux-memory` tests)
- `npx vitest run src/settings src/editmenu src/ports src/artifacts src/automations`: 124 files, 735 tests PASS (48.03s)
- `npx vitest run src/scm src/skills src/chat`: 83 files, 808 tests PASS (29.01s)
- `npx vitest run src/browser`: 43 files, 290 tests PASS (18.88s)
- `npx vitest run src/editor`: 109 passed / 2 failed under parallel CPU contention (`richSaveLists.test.ts:55` timing check 210ms > 150ms; `PreviewPane.test.ts:86` mermaid import > 5000ms); both passed when re-run alone (`2 files, 17 tests PASS`, 8.33s).

---

## 1. Goal 0 Inventory: Embedded Browser Removal

Per Txais (2026-11-12), the embedded browser pane goes away; agents and users open web pages in Chrome / the system browser (`open_external`) instead.

### 1.1 Owned by `o1-tools` (to delete or rewire in Round 2)

| Item | Location | Action in Round 2 |
|---|---|---|
| Embedded browser UI & logic (78 files) | `src/browser/*` (`BrowserPane.tsx`, `browser.css`, `DrawCanvas.tsx`, `GrabSheet.tsx`, `SendButton.tsx`, `openIn.ts`, `pages.ts`, `preview.ts`, `reopen.ts`, `address.ts`, `chord.ts`, `useBrowserChords.ts`, `cookies.ts`, `downloads.ts`, `dragThrough*.ts`, `history.ts`, `keys.ts`, `leave.ts`, `loadState.ts`, `menu.ts`, `picture.ts`, `popups.ts`, `previewActions.ts`, `scrub.ts`, `selfClose.ts`, `site.ts`, `suggest.ts`, `tips.ts`, `zoom.ts`, `annotate.ts`, `arm.ts`, `colour.ts`, `grab*.ts`, `__cards__/BROW-*.test.ts`, `UX2.test.ts`, `chordButtons.test.ts`, etc.) | **Delete** all except `notePdf.ts` (+ `notePdf.test.ts`), which **moves** to `src/editor/notePdf.ts` because `src/editor/PreviewPane.tsx:25` uses it for Markdown PDF export (`EDIT-018`). |
| Ports status bar open target | `src/ports/PortsItem.tsx:11,100`, `src/ports/PortsItem.test.ts:16`, `src/ports/ports.ts:80-81` | Replace `openInBrowser(url)` with `invoke("open_external", { url })`; simplify `openWhere`. |
| HTML preview open target | `src/editor/htmlPreview.ts:1-22`, `htmlPreview.test.ts`, `EditorPane.tsx:794-795`, `DiffPane.tsx:576` | Keep `browser_preview` loopback server (or coordinate rename), open returned URL with `invoke("open_external", { url })` instead of `openInBrowser`. Update button titles/aria-labels to "Preview in browser". |
| SCM Checks & Commit open target | `src/scm/ChecksPanel.tsx:10,45,157`, `src/scm/startPr.ts:65-68`, `startPr.test.ts:50-57`, `src/scm/SourceControlPanel.tsx:34,134,1322` | Open PR/commit URLs directly in system browser (`open_external`); remove `linksOpenInKolux` / `reviewWhere` / `"Open in the Kolux browser"` hints. |
| Chat web link chooser | `src/chat/ChatView.tsx:29,205-215,346`, `ChatText.tsx:13-23,38-42,82-120`, `ChatText.focus.test.ts`, `StepRows.tsx:50-59`, `chatLinks.ts:136-144`, `chatLinks.test.ts:82-100`, `stepLinks.test.ts`, `chat.css:130-133` | Remove `BrowserChoice` popup (`.chat-browser-menu`) and `inKolux` branching; web links open directly via `open_external`. |
| Settings browser toggles & search | `src/settings/GeneralPage.tsx:20,330-341,351` (`LinksCard`), `TerminalPage.tsx:220-226` (`Links` switch), `search.ts:19,63`, `outbound.ts:11,22`, `shortcutRows.ts:9,40,47`, `shortcutRows.test.ts:99-101`, `KeyLostNotice.tsx:15` (`browserSearchSessionUrl`), `settingsSync.ts:10` (`browserSearchSessionUrl`) | Remove `LinksCard` from GeneralPage, remove "Open web links from the terminal in the Kolux browser" switch from TerminalPage, remove `"browser"` area from `shortcutRows.ts`, update `outbound.ts` and `search.ts`. |
| Editor test references | `src/editor/t756.test.ts:54`, `src/editor/useFileMoves.test.ts:13,32` | Remove `GrabSheet.tsx` and `kind: "browser"` test cases. |

### 1.2 Owned by Other Lanes (Bug files filed in `_shared/bugs/`)

| Owner | What uses the embedded browser | Bug file |
|---|---|---|
| `c3-terminal` | **Rust backend:** `src-tauri/src/browser.rs` + 25 browser-pane submodules; `src-tauri/src/lib.rs:15,246-253,313-315,411,574,872-899,1096,1113-1114`; **CLI commands:** `src-tauri/src/cli/args.rs`, `mod.rs`, `text.rs`, `help.rs`, `local_cli.rs` (`goto`, `back`, `forward`, `reload`, `wait`, `eval`, `scroll`, `snapshot`, `screenshot`, `full-screenshot`, `pdf`, `click`..`mouse`, `exec`, `tab *`, `profiles *`, `cookie *`, `storage *`, `intercept *`, `capture *`, `console`, `network`, `viewport`, `geolocation`, `set device/offline/headers/credentials/media`, `clipboard *`, `dialog *`); `src-tauri/tests/cards_13.rs:47`. **NOTE — KEEP:** `browser_pdf.rs` (Markdown PDF export), `browser_tower.rs` (Tower window), `browser_preview.rs` (HTML loopback server), `web_icon.rs` helpers (`local_host`, `allowed`, `icon_client_for`), `webview2-com` crate (still used by `edit_menu.rs` and `webview_power.rs`). **Frontend:** `src/App.tsx`, `src/lazy/panes.tsx`, `src/shell/` (`browserOpen.ts`, `useWindowStart.ts`, `WindowView.tsx`, `windowSource.ts`, `windowBag.ts`, `windowStore.ts`, `findTab.ts`, `linkAsk.ts`, `LinkAskDialog.tsx`, `window/Pane.tsx`, `Grid.tsx`, `Content.tsx`, `Dialogs.tsx`, `lostWords.ts`), `src/chrome/` (`useWindowChrome.ts`, `reopenTab.ts`, `reach.test.ts`), `src/keys/` (`actions.ts`, `keyScopes.ts`, `runCommand.ts`, `useWindowKeys.ts`, tests), `src/terminal/` (`paneActions.ts`, `TerminalPane.tsx` `notePrinted`, `linkMenu.ts`, `links.ts`, `newTab.ts`, `newTabEntry.ts`, `layout.ts`, `pin.ts`, `tabName.tsx`, tests, `__cards__/TERM-040.test.ts`, `VIEW-024.test.ts`), `src/styles.css` (`.pane.browser`). | `_shared/bugs/c3-terminal/20261112-1105-remove-embedded-browser-backend-and-shell.md` |
| `c2-agents` | `src/onboarding/` (`guide.ts` `StepId = "browser"` / `PAGE_SHOWN`, `tour.ts` `TourId = "browser"`, `demos.ts` `"browser"` demo, `stopCards.ts` `STOP_SKILLS.browser`, `StepPanels.tsx`, `LiveStopCards.tsx`, tests), `src/launch/newTabEntryRun.ts`, `src/agents/` (`rail.ts`, `rail.test.ts`, `T809.test.ts`), `src/projects/` (`space.ts`, `WorktreePalette.tsx`, `__cards__/PROJ-066.test.ts`), `src/sessions/` (`livePane.test.ts`, `tabTitles.test.ts`), `src-tauri/src/import.rs:631`. | `_shared/bugs/c2-agents/20261112-1105-remove-embedded-browser-onboarding-and-panes.md` |
| `o2-tests` | `scripts/prove/` (`live-BROW.mjs`, `live-browser-939.mjs`, `live-browser-954.mjs`, `live-browser-977.mjs`, `live-browser-common.mjs`, `live-T-323-proxy.mjs`, `live-T-656.mjs`, `live-T-657.mjs`, `live-T-659.mjs`, `live-T-661.mjs`, plus embedded-browser steps in `live-checks.mjs`, `live-flood.mjs`, `live-installed.mjs`, `live-SET-*.mjs`, `live-T-544.mjs`, `live-T-816-nowin.mjs`, `update-rig.mjs`), `scripts/stress/` (`s11-footprint.mjs` phase f, `s12-everyday.mjs`, `s14-tab-move.mjs`, `s2-output-flood.mjs`, `lib.mjs`), `scripts/evidence/` (`app-launch.mjs:100`, `app-launch.test.mjs`, `cdp.mjs`, `overlap.mjs`). | `_shared/bugs/o2-tests/20261112-1105-remove-embedded-browser-proofs-and-stress.md` |
| `o3-rune` | `src/status/` (`credit.ts`, `credit.test.ts`, `manage.test.ts`, `useStatusSurfaces.ts`, `working.ts`, `working.test.ts` `kind !== "browser"` guards/fixtures). | `_shared/bugs/o3-rune/20261112-1105-remove-embedded-browser-status-refs.md` |
| `c1-coord` | `DECISIONS.md` (retire OD-18 / BROW-*), `CHANGELOG.md`, `PLAN.md`, `COMPAT.md`, `docs/guide/` (`feature-index.md`, `files-and-browser.md`, `command-line.md`, `safety.md`, `settings.md`, `getting-started.md`, `terminals.md`, `troubleshooting.md`), `docs/architecture/*.md`, `docs/development/*`, `scripts/glossary-check.mjs:29` (`["Tab", "src/browser/BrowserPane.tsx"]`), `scripts/privacy-audit.test.mjs:26,37-59,122`, `scripts/bundle-budget.mjs`, `scripts/csp.test.mjs`, and external skills repo `TxaisX/kolux-skills` (`~/.agents/skills/kolux-cli/SKILL.md` and `computer-use/SKILL.md` still mention "Kolux's embedded browser"; note in-repo `src-tauri/skills/kolux-cli/SKILL.md` already has no browser refs). | `_shared/bugs/c1-coord/20261112-1105-remove-embedded-browser-docs-decisions-gates.md` |

---

## 2. Audit Findings (`o1-tools` Scope)

### Fast Local Build & Dev Loop

- **F-01 · P1 · CONFIRMED · `src-tauri/Cargo.toml:81-86`, `scripts/release.mjs:252-357`, env `CARGO_TARGET_DIR` (unset)**
  - **What is wrong:** Trying a local change currently takes 30–45 minutes because `pnpm ship --main` / `pnpm release` runs `scripts/release.mjs`, which: (1) checks out into a separate `~/.kolux-rs/release-checkout`, (2) polls GitHub CI for up to 30 min (`requireGreenCi`, `POLL_MS = 30s`), (3) builds with `[profile.release]` (`codegen-units = 1`, `lto = true`, `opt-level = 3`), (4) builds `kolux-cli.exe` separately + NSIS installer + smoke + minisign. Meanwhile, `CARGO_TARGET_DIR` is unset on this PC, so every worktree (`G:\Dev\kolux-lanes\o1-tools\src-tauri\target` didn't exist at round start) rebuilds all Rust crates from scratch instead of sharing a cached target dir.
  - **Measured baselines (this PC, 2026-11-12):**
    - Warm `pnpm install`: **0.62s** (2.8s when `node_modules` missing).
    - `npx tsc --noEmit`: **19.43s**.
    - `npx vite build`: **9.68s**.
    - `CARGO_TARGET_DIR`: unset; `G:\Dev\kolux\src-tauri\target` has `debug/` only; `~/.kolux-rs/release-checkout/src-tauri/target` has `release/` only.
  - **Fix (Round 2):** Add `pnpm local` (`scripts/local-run.mjs`) + `docs/dev-loop.md`: builds `kolux.exe` (release or fast-local cargo profile/flags, no installer, no signing, no GitHub, no CI wait), reuses one shared `CARGO_TARGET_DIR` (e.g., `G:\Dev\.kolux-target` or `%LOCALAPPDATA%\kolux-local-target`), overrides config with identifier `com.txaisxiong.kolux.local` so it never shares settings/mutex with Txais's installed Kolux, and launches it detached. Note: check `agent_hooks::fenced` (`src-tauri/src/agent_hooks/mod.rs:457`) vs `KOLUX_APP_DIR` so local testing behavior is documented clearly.
  - **Cost:** ~0.5 day.

---

### `src/editor/` & `src/editmenu/`

- **F-02 · P1 · CONFIRMED · `src/editor/AllChangesPane.tsx:30`, `src/editor/DiffPane.tsx:29`, `src/editor/DiskBanner.tsx:16`, `src/editor/EditorPane.tsx:49,92-183`**
  - **What is wrong:** `EditorPane.tsx` (915 lines) exports `look`, `copiers`, `editors`, `saveFile`, `saveQuiet`, `StaleNotice`, `stampOne`, while `EditorPane.tsx` statically imports `DiffPane` (`DiffPane.tsx:29` imports `EditorPane` back — circular dependency) and `AllChangesPane.tsx` + `DiskBanner.tsx` statically import from `EditorPane.tsx`. `vite build` explicitly warns: `[INEFFECTIVE_DYNAMIC_IMPORT] src/editor/EditorPane.tsx is dynamically imported by CloseDialog.tsx, NotebookView.tsx, src/lazy/panes.tsx but also statically imported by AllChangesPane.tsx, DiffPane.tsx, DiskBanner.tsx, dynamic import will not move module into another chunk.` This defeats lazy-loading `EditorPane.tsx` (CodeMirror + extensions) when only `AllChangesPane` or `DiffPane` is loaded!
  - **Fix:** Extract `look`, `saveFile`, `saveQuiet`, `stampOne`, and `StaleNotice` out of `EditorPane.tsx` into `src/editor/editorShared.ts` / `StaleNotice.tsx` (and import `copiers`/`editors` directly from `../keys/handles`), breaking the circular import and eliminating the `INEFFECTIVE_DYNAMIC_IMPORT` warning. Also shrinks `EditorPane.tsx` below ~800 lines.
  - **Cost:** ~2 hours.

- **F-03 · P2 · CONFIRMED · `src/editor/Explorer.tsx:541`**
  - **What is wrong:** `const relative = (p: string) => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, "") : p);` uses case-sensitive `startsWith(root)`. On Windows, if `p` and `root` differ in drive-letter case (`C:\` vs `c:\`) or slash style, `Copy relative path` (`fileExplorer.copyRelativePath`) returns the full absolute path instead of the relative path, even though `Explorer.tsx` already imports `insideDir` (`explorerBar.ts`) and `openIn.ts` has `relInside`.
  - **Fix:** Reuse `relInside(root, p) ?? p` (or case-insensitive prefix strip).
  - **Cost:** ~15 min.

- **F-04 · P2 · CONFIRMED · `src/editor/Explorer.tsx` (1012 lines), `src/editor/EditorPane.tsx` (915 lines)**
  - **What is wrong:** Both files exceed the ~800-line threshold (`Explorer.tsx`: 1012 lines mixing tree state/virtualization, undo/redo/clipboard/drag-drop ops, and context menu/dialog rendering; `EditorPane.tsx`: 915 lines mixing save/stale helpers, CodeMirror setup, rich markdown view, disk-change polling, and toolbar UI).
  - **Fix:** Split `EditorPane.tsx` (per F-02, extract `editorShared.ts` + `StaleNotice.tsx`, and optionally rich-mode wiring); split `Explorer.tsx` along clean seams (`explorerOps.ts` for undo/redo/clipboard/drop orchestration + `ExplorerMenus.tsx` for row/open-in menus & delete Ask).
  - **Cost:** ~3 hours.

- **F-05 · P2 · CONFIRMED · `src/editor/buffers.ts:150` vs `src/editor/Explorer.tsx:85` vs `src/chat/attach.ts:42`; `src/editor/imageFiles.ts:20` vs `src/editor/pdfFiles.ts:37`; `src/editor/imageFiles.ts` vs `src/chat/attach.ts:39`**
  - **What is wrong:** Duplicated helpers inside `o1-tools`:
    - `baseName` is implemented identically in `buffers.ts:150` and `Explorer.tsx:85` (plus `nameOf` in `chat/attach.ts:42`).
    - `clampZoom` is implemented in both `imageFiles.ts:20` and `pdfFiles.ts:37` (parameterize min/max in one helper).
    - `pastedName` is duplicated in `imageFiles.ts` and `chat/attach.ts:39`.
  - **Fix:** Deduplicate `baseName` (reuse `buffers.ts` in `Explorer.tsx`) and `pastedName` / `clampZoom` where semantics match.
  - **Cost:** ~1 hour.

- **F-06 · P2 · CONFIRMED · `src/editor/richSaveLists.test.ts:55`, `src/editor/PreviewPane.test.ts:86`**
  - **What is wrong:** Slow/timing-sensitive tests fail under parallel lane CPU contention (`richSaveLists.test.ts:55` asserts `msKey < 150` and hit `210.49ms` during `vitest run src/editor`; `PreviewPane.test.ts:86` dynamically imports `mermaid` inside default 5000ms timeout and timed out at `5484ms`). Both passed immediately when run alone (8.33s).
  - **Fix:** Warm `mermaid` import in `beforeAll` (or give that test an explicit timeout) and review `richSaveLists.test.ts` warm-up / timing assertion so parallel runs aren't flaky.
  - **Cost:** ~30 min.

- **F-07 · P2 · PLAUSIBLE · `src/editor/PdfView.tsx` (338 lines), `src/editor/useSectionWindow.ts` (159 lines), `src/editor/fileLineKeeping.ts` (70 lines)**
  - **What is wrong:** Missing tests on risky UI/virtualization paths: `PdfView.tsx` (worker initialization `workerPort`, `IntersectionObserver` canvas disposal, `forget(path)` on unmount, retry on error) has 0 component tests; `useSectionWindow.ts` (virtualized spacer math for `AllChangesPane` large diffs) and `fileLineKeeping.ts` have 0 direct unit tests.
  - **Fix:** Add focused unit/component tests for `PdfView.tsx`, `useSectionWindow.ts`, and `fileLineKeeping.ts`.
  - **Cost:** ~2 hours.

- **F-08 · P3 · CONFIRMED · `src/editor/AllChangesPane.tsx:256-302`**
  - **What is wrong:** `stage` (`useCallback(..., [root])`) calls `act`, which is defined inline every render and omitted from `stage`'s dependency array. Today `act` only touches refs (`latest`, `rereadRef`, `reload`), `turn`, and `setState`, so it doesn't break at runtime, but it's a fragile stale-closure hazard if `act` ever reads reactive state (e.g. `mode` or `pinnedBase`).
  - **Fix:** Wrap `act` in `useCallback` or store it in a ref like `reload`/`rereadRef`.
  - **Cost:** ~15 min.

---

### `src/scm/`

- **F-09 · P2 · CONFIRMED · `src/scm/SourceControlPanel.tsx` (1350 lines), `FailureNotice.tsx`, `FileOpenWith.tsx`, `openWith.ts`, `HandoffNote.tsx`, `LineNotes.tsx`, `LocalOnlyBadge.tsx`**
  - **What is wrong:** `SourceControlPanel.tsx` (1,350 lines — well over 800 lines) and `LineNotes.tsx` (105 lines), `FailureNotice.tsx`, `FileOpenWith.tsx`, `openWith.ts`, `HandoffNote.tsx`, `LocalOnlyBadge.tsx` have **zero production callers**. `T-644` (`DT-C85`) removed the Source Control tab from `RightSidebar.tsx` and kept `src/scm/*` temporarily for lane E's auto-PR work, which is now shipped (`autoPr.ts`, `oneClick.ts`, `AutoPrStatus.tsx` used by `InsightsPanel.tsx`). Meanwhile `SourceControlPanel.tsx` is 1,350 lines of dead UI (including `openInBrowser` and older audit bugs noted in `repo-audit-2026-10-30-app.md`).
  - **Fix:** Ask `c1-coord` to confirm retiring `SourceControlPanel.tsx` + its exclusive dead UI children (`FailureNotice.tsx`, `FileOpenWith.tsx`, `openWith.ts`, `HandoffNote.tsx`, `LineNotes.tsx`, `LocalOnlyBadge.tsx`) and their tests (`SourceControlPanel.keys.test.ts`, `discardSwitch.test.ts`, `commitShortcut.test.ts`, `commitRowKeys.test.ts`, `actionError.test.ts`, `mergeBox.test.ts`), while keeping all live `src/scm/` files (`ChecksPanel`, `CheckPane`, `CommentsPanel`, `ConflictPanel`, `PrStart`, `StackMap`, `AutoPrStatus`, `model.ts`, `checks.ts`, `autoPr.ts`, `oneClick.ts`, `changesActions.ts`, etc.). If kept, `SourceControlPanel.tsx` must be split below 800 lines.
  - **Cost:** ~2 hours (cleanup + test/glossary checks).

- **F-10 · P3 · CONFIRMED · `src/scm/ConflictPanel.tsx` (93 lines), `src/scm/WriterPicker.tsx` (125 lines)**
  - **What is wrong:** Both live components have zero direct unit/render tests (`ConflictPanel` handles rebase/merge conflict resolution triggers inside `ChecksPanel`; `WriterPicker` handles commit-message writer configuration inside `GitPage`).
  - **Fix:** Add unit/render tests for `ConflictPanel.tsx` and `WriterPicker.tsx`.
  - **Cost:** ~1 hour.

---

### `src/settings/`

- **F-11 · P2 · CONFIRMED · `src/settings/pickers.ts` (49 lines)**
  - **What is wrong:** Dead code — `pickers.ts` (`numberFromField`, `narrowOptions`, `segmentViews`, `isSubmitChord`) has zero production imports anywhere in `src/`; only `src/settings/pickers.test.ts` imports it.
  - **Fix:** Delete `pickers.ts` and `pickers.test.ts` (or wire if intended — grep shows `GeneralPage`/`ExperimentalCard`/`AppearancePage` implemented their own `delayFromText`/`minutesFromText`/`Segmented`).
  - **Cost:** ~15 min.

- **F-12 · P2 · CONFIRMED · `src/settings/settings.css:32,46,63,143`**
  - **What is wrong:** Duplicated/shadowed CSS rules inside `settings.css`:
    - Line 32 `.settings-main .conn-card + .conn-card { margin-top: 0; }` is overridden by line 63 `.settings-main .conn-card + .conn-card { margin-top: 12px; }`.
    - Line 143 `.term-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); ... }` is overridden by higher-specificity line 46 `.settings-main .term-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); ... }` (making the responsive `auto-fill` rule dead!).
  - **Fix:** Remove the shadowed dead declarations and verify `TerminalPage` / `AppearancePage` layout in harness screenshot.
  - **Cost:** ~30 min.

- **F-13 · P3 · CONFIRMED · `src/settings/zoom.ts` vs `src/chat/zoom.ts`; `src/settings/customThemeStore.ts` `freeName` vs `src/editor/imageFiles.ts` `freeName`**
  - **What is wrong:** Minor duplicated helpers (`stepZoom` in both `settings/zoom.ts` and `chat/zoom.ts`; `freeName` in both `settings/customThemeStore.ts` and `editor/imageFiles.ts`). Also `src/editor/openIn.ts` still contains legacy `cleanApps`/`PRESETS`/`SETTING` alongside `readOpenIn` from `src/settings/openIn.ts`.
  - **Fix:** Remove unused legacy `cleanApps`/`PRESETS` from `src/editor/openIn.ts` (after verifying tests) and consolidate if clean.
  - **Cost:** ~30 min.

- **F-14 · P3 · CONFIRMED · `src/settings/NotificationSwitches.tsx` (40 lines)**
  - **What is wrong:** No direct test covering `NotificationSwitches.tsx` rendering/toggles.
  - **Fix:** Add a quick render/toggle test alongside `NotificationsPage`.
  - **Cost:** ~20 min.

---

### `src/chat/`

- **F-15 · P3 · CONFIRMED · `src/chat/ChatText.tsx:29-42` vs `src/chat/StepRows.tsx:51-59`**
  - **What is wrong:** `StepRows.tsx` exports its own `openLink` wrapper around `ChatText.tsx`'s `openLink` (with a silent `.catch(() => {})` fallback when `host` is absent, unlike `ChatText.tsx` which reports `host.say`). After Goal 0 removes `BrowserChoice` (`.chat-browser-menu`), both should route through one helper cleanly.
  - **Fix:** Clean up `BrowserChoice` + `inKolux` in Round 2 (Goal 0) and unify link-opening error handling.
  - **Cost:** ~30 min (folded into Goal 0).

---

### `src/automations/`, `src/skills/`, `src/artifacts/`, `src/ports/`

- **F-16 · P3 · CONFIRMED · `src/automations/AutomationsPage.tsx:186`**
  - **What is wrong:** `rowEl = (id: string) => root.current?.querySelector<HTMLElement>(\`tr[data-id="${id}"]\`)` interpolates `id` raw into a CSS attribute selector. An external automation id (e.g. from Hermes/OpenClaw) containing `"` or `\` would throw a `DOMException` on focus/keyboard navigation.
  - **Fix:** Escape with `CSS.escape(id)` (with safe fallback when `CSS.escape` is absent in Node unit tests).
  - **Cost:** ~15 min.

- **F-17 · P3 · CONFIRMED · `src/skills/SkillUpdateNotice.tsx` (45 lines)**
  - **What is wrong:** Has no direct component test (`noticeMount.test.ts` tests mounting logic, not `SkillUpdateNotice.tsx` props/buttons).
  - **Fix:** Add render + click test for `SkillUpdateNotice.tsx`.
  - **Cost:** ~20 min.

- **F-18 · P2 · CONFIRMED · `src/ports/PortsItem.tsx:2-3,97-101`, `src/ports/ports.ts:80-81`**
  - **What is wrong:** Clicking Open in the Ports status-bar popover currently opens the embedded browser (`openInBrowser(url)`), and `Shift+Ctrl-click` opens the system browser (`open_external`). Per Goal 0, this breaks once `src/browser/` is removed.
  - **Fix (Round 2):** Plain click opens `url` in the system browser (`invoke("open_external", { url })`); remove `openInBrowser` import and update `ports.ts`/`PortsItem.test.ts`.
  - **Cost:** ~30 min.

- **F-19 · P2 · CONFIRMED · `src/artifacts/ArtifactsPage.tsx`**
  - **What is wrong:** Checked `ArtifactsPage.tsx` for Goal 0: `ArtifactsPage` ALREADY opens external links in the system browser via `open_external` after user confirmation (`DT-C77`) and does NOT depend on `src/browser/`. No embedded-browser dependency; clean.

---

## 3. Round 2 Priority Plan

1. **Goal 0 (`o1-tools` side):** Delete `src/browser/` (extracting `notePdf.ts` + `notePdf.test.ts` to `src/editor/`), replace `openInBrowser` in `PortsItem.tsx`, `htmlPreview.ts`, `ChecksPanel.tsx`, `ChatView.tsx`/`ChatText.tsx`/`chatLinks.ts`, and remove browser settings/shortcuts from `src/settings/`.
2. **Fast local loop:** Measure dev launch + Rust rebuild baseline, implement `pnpm local` (`scripts/local-run.mjs`) with shared `CARGO_TARGET_DIR` and `com.txaisxiong.kolux.local` identifier, and write `docs/dev-loop.md` with before/after timings.
3. **Verify owned screens live in the harness** against `docs/guide/feature-index.md` and fix any broken UI/features.
4. **Fix audit findings & refactor:** Break `EditorPane.tsx` circular/static imports (`F-02`, eliminating `INEFFECTIVE_DYNAMIC_IMPORT`), split `EditorPane.tsx` and `Explorer.tsx` below 800 lines (`F-04`), fix `Explorer` `relative()` Windows case sensitivity (`F-03`), fix `AutomationsPage` `CSS.escape` (`F-16`), remove dead `pickers.ts` (`F-11`) and shadowed CSS (`F-12`), clean up `SourceControlPanel.tsx` if coordinator approves (`F-09`), deduplicate helpers (`F-05`, `F-13`), and add missing tests (`F-06`, `F-07`, `F-10`, `F-14`, `F-17`).

---

# 4. Second pass (2026-11-12 11:43) — measurements, hazards, new findings

This pass re-measured the build loop with hard numbers, checked what the Goal 0 removal
*breaks inside Rust*, and audited render-path cost. Findings that repeat section 2 are
cross-referenced by their F-number and not relisted.

## 4.1 Measured on this PC (quoted commands)

| Step | Command | Time |
|---|---|---|
| Warm dependency install | `pnpm install --prefer-offline` | **0.8 s** (`Done in 24ms`) |
| Frontend build (`tsc && vite build`) | `pnpm build` | **31 s** (`✓ built in 5.12s` for vite) |
| Rust **debug**, app-crate rebuild, target warm | `cargo build --manifest-path src-tauri/Cargo.toml` in `G:\Dev\kolux` | **2 m 42 s** (`Finished dev profile [unoptimized + debuginfo] target(s) in 2m 42s`) |
| Rust **release**, app-crate rebuild, deps already compiled | `cargo build --release …` in `~/.kolux-rs/release-checkout` (target 4.3 GB) | **19 m 55 s** (`Finished release profile [optimized] target(s) in 19m 55s`) |

Same crate, same source, same machine: **release costs 7x debug**. The release step is ~95% of
the 30-45 minutes Txais waits; `scripts/release.mjs:356` adds only NSIS + smoke + sign on top.

Target dirs on disk: `G:\Dev\kolux\src-tauri\target` **56 GB**, release checkout **4.3 GB**,
this lane's worktree: **none** (so any run here is a cold build).

## 4.2 The local loop: the new findings

| # | Finding | Severity | State | Evidence | Fix | Cost |
|---|---|---|---|---|---|---|
| L-1 | **`lto = true` + `codegen-units = 1` are what make a release build 7x a debug build.** Both a "try my change" build and the shipped installer pay them; a local build needs neither. | P1 | CONFIRMED | `src-tauri/Cargo.toml` `[profile.release]` (`codegen-units = 1, lto = true, opt-level = 3, panic = "abort", strip = true`); 2m42s vs 19m55s above | add `[profile.local] inherits = "release"` with `lto = "thin"`, `codegen-units = 16`, `strip = false`, `incremental = true`, `opt-level = 2`; `pnpm local` builds `--profile local` | 20 min + one timed run |
| L-2 | `tauri build --no-bundle` exists (tauri-cli 2.12.4) and is unused: every local try also builds NSIS + updater artifacts + signature. | P1 | CONFIRMED | `npx tauri build --help` lists `--no-bundle`; the only build call is `scripts/release.mjs:356` | `pnpm local` = `tauri build --no-bundle --profile local --config <local.json>` then launch the exe | 30 min |
| L-3 | The harness already honours `CARGO_TARGET_DIR` (`scripts/evidence/app-launch.mjs:468`) but nothing sets it, so every lane and checkout rebuilds from cold. | P1 | CONFIRMED | code quoted; `src-tauri/target` absent here | default `CARGO_TARGET_DIR` to one shared folder for local builds; document "one local build at a time" (cargo takes the target lock) | 40 min |
| L-4 | The identifier is compiled in, so the local build must pass `--config` at build time or it shares Txais's installed profile. | P2 | CONFIRMED | `src-tauri/tauri.conf.json` `identifier: com.txaisxiong.kolux`; harness writes its own `tauri.dev.json` (`app-launch.mjs:369,453`) | `local.json`: `identifier: com.txaisxiong.kolux.local`, `productName: "Kolux Local"`, updater off | in L-2 |
| L-5 | Ceiling: the app's own Rust is **one 168k-line crate** (210 files), so the smallest Rust edit recompiles the whole binary. No profile tweak beats that. | P2 | CONFIRMED | `find src-tauri/src -name '*.rs'` → 210 files, 167,815 lines, one `Cargo.toml` | split into crates — days, not this wave; record it so nobody promises "seconds" for Rust edits | days |

`docs/dev-loop.md` (round 2) will carry this table:

| Change | Command | Expected |
|---|---|---|
| CSS / TSX / logic | dev build with `--config` (harness or `pnpm local:dev`) | ~2 s per save (HMR) |
| Rust | same dev build | ~2-3 min (measured 2m42s, whole crate) |
| Whole app at release speed, no installer | `pnpm local` | target ~4 min (measure after L-1) |
| Installer | `pnpm release` | 30-45 min, unchanged, releases only |

## 4.3 Hazards: what breaks inside Rust if `browser*` is deleted as-is

Section 1.2 lists `browser_pdf.rs`, `browser_tower.rs`, `browser_preview.rs` and the
`web_icon.rs` helpers as KEEP. This pass found a fourth, and it is the dangerous one:

| # | Hazard | Severity | State | Evidence | Owner |
|---|---|---|---|---|---|
| H-1 | **The update check calls `crate::browser::head(...)`** — the app's only HTTP client with its proxy/cert policy. Deleting the browser modules silently removes the ability to update: no error, the check just stops working. | **P0** | CONFIRMED | `src-tauri/src/update.rs:163`; the same module's test at `update.rs:548` asserts call order against `browser::head` | c3-terminal |
| H-2 | Project icons call `browser::allowed`, `local_host`, `icon_clients`, `fetch_icon_within`, `public_addrs`, `hop_ok`. | P1 | CONFIRMED | `src-tauri/src/web_icon.rs:46,81-83,94,214-251`; `src-tauri/src/projects.rs:3237-3300` | c3-terminal + c2-agents |
| H-3 | The Tower's window is built by `browser::tower::tower_window_open` — a plain `WebviewWindowBuilder` that only happens to live in the browser module. | P1 | CONFIRMED | `src-tauri/src/browser_tower.rs:45`, registered `lib.rs:887`, called from `src/tower/ownWindow.ts:133`; `lib.rs:233` gates it | c3-terminal |
| H-4 | The startup-order test names `browser::helpers::sweep_at_start` as a startup mark. | P3 | CONFIRMED | `src-tauri/src/startup_marks.rs:238` | c3-terminal |
| H-5 | Tab state is persisted to `browser-tabs.json` in the app data folder; nothing cleans it after removal. | P3 | CONFIRMED | `src-tauri/src/browser_session.rs:4,21` | c3-terminal |

**Safe shape for the Rust cut:** reduce `browser.rs` to a ~600-line `net.rs`
(`head`/`get`, `allowed`, `local_host`, `public_addrs`, `hop_ok`, `icon_clients`,
`fetch_icon_within`), move `tower_window_open` beside the other window builders, then delete the
remaining 27 modules / ~14,000 lines. Filed as
`_shared/bugs/c3-terminal/20261112-1143-browser-net-helpers-must-survive.md`.

## 4.4 New findings — `src/editor/` + `src/editmenu/`

| # | Finding | Severity | State | Evidence | Fix | Cost |
|---|---|---|---|---|---|---|
| N-01 | HTML "Preview" becomes a silent no-op: it opens the pane, and an event with no listener shows nothing. | P1 | CONFIRMED | `EditorPane.tsx:791`, `DiffPane.tsx:576` → `htmlPreview.ts:15` dispatches `openInBrowser`; the only listener is `shell/useWindowStart.ts:94` | repoint the default `open` to `invoke("open_external")`, or drop the button | 30 min |
| N-02 | `notePdf.ts` (100 lines) and `openIn.ts` (15 lines) inside `src/browser/` have **zero imports of their own** and are imported from outside; every other file in `src/browser/` is internal. | P3 | CONFIRMED | `grep '^import' src/browser/notePdf.ts src/browser/openIn.ts` → none | move them out first, then the delete is trivial | 20 min |
| N-03 | Every visible editor tab runs a **2 s `file_stamps` poll**, and each poll lists worktrees under the fence mutex while an agent-worktree file is open. N tabs = N IPC calls per 2 s serialised on one mutex, competing with agents writing files. | P2 | CONFIRMED | `EditorPane.tsx:446-450` including its own comment describing the upgrade | one shared poller for all visible paths, or cache the fence decision per tab | 2 h |
| N-04 | Preview re-parses and re-sanitises the entire note on **every keystroke**; EditorPane debounces the same job at 300 ms. | P2 | CONFIRMED | `PreviewPane.tsx:135-138` (`tell` fires per transaction) vs `EditorPane.tsx:353-355` | copy the 300 ms debounce | 20 min |
| N-05 | All Changes `JSON.stringify`s the whole change list (old and new) on every watcher tick, on the UI thread. | P2 | CONFIRMED | `AllChangesPane.tsx:186` | compare a cheap signature (length + first/last stamp) or a back-end list hash | 45 min |
| N-06 | Explorer re-flattens the whole tree in the render body, once per scroll tick too. | P2 | CONFIRMED | `Explorer.tsx:382-384`; scroll handler `:212` sets state per wheel event | three `useMemo`s: `visible`, `rows`, `index` | 30 min |
| N-07 | **Right-click gives no menu at all on non-editable text**, and the host cancels the webview's own menu: no right-click Copy in the preview, chat, diff cards or PDF view, anywhere in the app. | P2 | CONFIRMED | `EditMenuHost.tsx:92-95` (`kind === "none"` → `preventDefault(); return`), `editMenuModel.ts:31` | for `"none"` with a non-empty selection show a Copy-only menu; suppress only when there is no selection | 1 h |
| N-08 | Save guard is a clean 90-line seam inside a 933-line component, forcing two `await import("./EditorPane")` calls to dodge the cycle. | P3 | CONFIRMED | `EditorPane.tsx:95-183`; `CloseDialog.tsx:15`, `NotebookView.tsx:122` | move to `editor/saveGuards.ts` (fold into F-02) | 45 min |
| N-09 | `frontMatter.ts` (777) is 90% a list-gap placement engine; the real front-matter surface is ~30 lines. | P3 | CONFIRMED | `splitFront` `:13`, `hideFrontFor` `:775`; the engine is `:117-604`; `collapseGaps`/`blockSpans` have no callers outside the file | split `richPlacement.ts` | 1 h |
| N-10 | Dead exports: `viewSwitch.ts:25,28,32` (`changesBanner`, `viewEditable`, `headSides`) and `diskChange.ts:18` (`sameStamp`) have test-only callers. | P3 | CONFIRMED | grep across `src/` excluding tests → 0 hits | delete, or wire `viewEditable` into the table view's read-only | 15 min |
| N-11 | The path key is re-implemented four times; the rail's copy mangles WSL paths, so review notes never match a WSL file. | P3 | CONFIRMED | `buffers.ts:141` (`keyOf`) vs `rail.ts:12`, `desktopDrops.ts:19`, `noteLinks.ts:78` | import `keyOf` in all three | 20 min |
| N-12 | `EditorPane.tsx` (933) has no test of its own: the poll effect, editors latch and rich/source switch are untested. | P3 | CONFIRMED | no `EditorPane.test.ts` | one test for latch lifecycle + poll guard | 3 h |
| N-13 | `htmlPreview.test.ts:4` mocks `../browser/BrowserPane` — a module the code never imports; it passes only because `open` is injected. | P3 | CONFIRMED | `htmlPreview.ts:5` imports `../browser/openIn` | delete the mock line | 5 min |
| N-14 | Moving `look` (a 30-line theme at `EditorPane.tsx:188`) is the smallest fix for F-02's warning; `DiskBanner.tsx:16` is a third static importer not named in F-02. | P3 | CONFIRMED | `pnpm build` warning text | `editor/editorTheme.ts` | 20 min |

## 4.5 New findings — `src/scm/` + `src/ports/` + `src/artifacts/`

| # | Finding | Severity | State | Evidence | Fix | Cost |
|---|---|---|---|---|---|---|
| N-15 | Checks panel's PR link: a **plain click** goes to the pane, so after removal the link does nothing and says nothing. `openOut` already exists in the same file. | P1 | CONFIRMED | `ChecksPanel.tsx:157` vs `:47` | replace the branch with `openOut(pr.url)`; drop `inKolux`, `reviewHint`, the title hint and the `useSettings` import | 15 min |
| N-16 | Checks-tab create block freezes: **one** `scm_status` read on mount, no watcher — commit in the terminal and it still says "Commit your changes first". After the 5-minute readiness TTL it renders "Checking whether this branch is ready…" forever (no button, no timer). | P2 | CONFIRMED | `PrStart.tsx:52-74`, `:92`, `:237`; `watch.ts:27` exists and is unused here | subscribe to `watchStatus(dir)` and seed from its first push | 45 min |
| N-17 | Opening Ports wipes the list and the count, and drops the last good list on a scan error (which makes the "Showing the last list." note a lie). | P2 | CONFIRMED | `PortsItem.tsx:61-70` — the clear sits in an effect keyed on `[active, open]` | clear only when `active` changed | 20 min |
| N-18 | Two `git status` runs per Checks-tab open, one thrown away (Rust `scm_pr_checks` + frontend `scm_status`). | P2 | CONFIRMED | `PrStart.tsx:54` vs `src-tauri/src/scm.rs:2326` | fixed by N-16 | — |
| N-19 | Four hand-rolled "open in the system browser + show the failure" copies with four different sinks; `PrStart.tsx:217` also carries a dead ternary inside a `kind === "found"` branch. | P2 | CONFIRMED | `ChecksPanel.tsx:47`, `StackMap.tsx:103`, `AutoPrStatus.tsx:69`, `PrStart.tsx:217` | one `openOut` in `panelUx.ts` beside `openLinkFailed` | 20 min |
| N-20 | `PrStart.tsx` (280) and `CommentsPanel.tsx` (418) are live-logic components with **no test**; `PrStart` is reached only through `?raw` source-text assertions, `CommentsPanel` through nothing at all. | P2 | CONFIRMED | `commitShortcut.test.ts:9`, `panelUx.test.ts:5` are `?raw`; no `CommentsPanel.test.ts` | one render test each (readiness gating; `act()` failure lands in `rowError`) | 1.5 h |
| N-21 | Artifacts rescans every 3 s with **no visibility guard** and swallows scan errors, so a broken folder looks idle. | P3 | CONFIRMED | `ArtifactsPage.tsx:294` (`.catch(() => {})`), `:297` (`setInterval(scan, 3000)`) | pause on `visibilitychange`; toast the first error | 20 min |
| N-22 | Two more dead exports: `model.ts:207` (`withLink`), `:327` (`acLayoutOf`) — test-only callers, and `AllChangesPane.tsx:45` builds the layout itself instead of calling the tested helper. | P3 | CONFIRMED | grep | delete, or make `AllChangesPane` call it | 10 min |
| N-23 | `model.ts` (686) has three clean seams: commit graph `:143-192`, merge box `:548-592`, AI budget `:593-604` (budget used only by `settings/GitPage.tsx:9`). | P3 | CONFIRMED | traced | split `graph.ts` / `mergeBox.ts` / `budget.ts`; re-export for one release | 40 min |
| N-24 | Every emoji reaction re-reads the whole review from GitHub (all threads, all comments), and `replyAndResolve` adds another full read. | P3 | CONFIRMED | `CommentsPanel.tsx:130-143`, `:187` | patch the changed row locally; reconcile on the next explicit refresh | 30 min |
| N-25 | The port list can never show a UDP listener, though the panel promises "the ports this workspace is listening on"; a Rust test locks the TCP-only behaviour in. | P3 | CONFIRMED | `src-tauri/src/ports.rs:2,65,676` | parse UDP (1 h) or reword the two doc lines (5 min) | 5 min |

## 4.6 New findings — `src/chat/` + `src/skills/` + `src/automations/`

| # | Finding | Severity | State | Evidence | Fix | Cost |
|---|---|---|---|---|---|---|
| N-26 | Chat's link flow points at the pane: `webClick` can return `"kolux"` and the composer offers a "choose browser" menu. This is F-15's other half and the piece that **stops the pane deletion from compiling** once `openInBrowser` is gone. | P1 | CONFIRMED | `chatLinks.ts:140-145`; callers `ChatText.tsx:6,38`, `chatLinks.test.ts:85-100`; `StepRows.tsx:10,58-63` via `openLink`; host passed from `shell/window/Content.tsx:159` | make `webClick` system-only: drop `inKolux`/`viewer`, the `Browser` `"kolux"` value, the `ask` state, `BrowserChoice` (`ChatText.tsx:84`), `LinkHost.chooseBrowser`/`inKolux`, and the menu in `ChatView.tsx:198-213,346` | 60-90 min |
| N-27 | The composer's `commands` prop is declared and threaded but **never passed**, so the reported-command path always falls back to the built-in list; the feature is reachable only from a test. | P2 | CONFIRMED | `MessageBox.tsx:39-40,45,66`; the only render site `ChatView.tsx:347` passes none; `complete.ts:99` | delete the prop and the `reported` plumbing | 20 min |
| N-28 | The automation dialog still carries the deleted "new worktree per run" plumbing: `mode`, `base` and `runSetup` are constants and `setupChoice()` has no product caller. | P2 | CONFIRMED | `AutomationDialog.tsx:91-98,123-126,188,276`, `model.ts:22` | delete `setupChoice` and the three dead keys | 30 min |
| N-29 | Chat re-renders and re-parses markdown for the whole transcript on every poll: `takeRead` returns a fresh object each poll, `ViewRow` is a plain function, and each plan row re-runs `renderMarkdown` + `dangerouslySetInnerHTML`. | P2 | PLAUSIBLE | `ChatView.tsx:99,110,347,360`, `StepRows.tsx:123`, `reading.ts:71` | `memo(ViewRow)`, `useMemo` the markdown per row and the link-host object | 45 min |
| N-30 | Five files with real IPC logic and no test: `ChatView.tsx`, `MessageBox.tsx`, `AutomationsPage.tsx` (SSR-only test, so no effect ever runs), `RunsDashboard.tsx`, `SkillUpdate.tsx`. | P2 | CONFIRMED | `AutomationsPage.test.ts` uses `renderToString`; `SkillUpdate` has only source-text assertions | one fake-DOM test each for the handler that calls `invoke` | 2 h |
| N-31 | `linksOpenInKolux` is read as a raw literal in two files and as a second constant (`KOLUX_FIELD`) in a third — changing the key means four edits. | P3 | CONFIRMED | `chatLinks.ts:148-149`, `shell/linkAsk.ts:6`, `shell/window/Pane.tsx:255`, `scm/ChecksPanel.tsx:45` | one import; collapses to zero readers after N-26 | 15 min |
| N-32 | Every Hermes/OpenClaw row action reads the automation list **twice** (`act` ends in `load`, and `refresh` already ends in `load`). | P3 | CONFIRMED | `AutomationsPage.tsx:242-245` + `:112-125` | drop the second load | 10 min |
| N-33 | The 30 s clock keeps ticking while the window is hidden, re-sorting and re-rendering 760 lines each tick. The pattern to copy already exists. | P3 | CONFIRMED | `AutomationsPage.tsx:158,169-172`; `chat/ux.ts:26` (`pollMs`/`watchHidden`) | reuse `watchHidden` | 20 min |
| N-34 | A repeated identical hook reply is silently dropped (dedupe on text alone), though the comment only justifies a per-millisecond id. | P3 | PLAUSIBLE | `ChatView.tsx:89` | dedupe on `(text, at)` | 15 min |
| N-35 | "Rerun" clears its pending state after a fixed 1.5 s whatever happened, and the timer is not cleared on unmount. | P3 | CONFIRMED | `AutomationsPage.tsx:553` | hold the id in the parent's running list, as `runNow` does | 20 min |
| N-36 | A swallowed hook-subscription failure turns into a misleading "Kolux can't see this agent's prompts. Type in its terminal." on every send, with no cause shown. | P3 | CONFIRMED | `ChatView.tsx:68`, `send.ts:125`, `StepRows.tsx:58-60` | surface the failure, or gate the note on a `hearingFailed` flag | 10 min |
| N-37 | Three list-search implementations with three normalisations. | P3 | CONFIRMED | `automations/model.ts:96`, `:314`, `skills/skills.ts:54` | one shared `includesQuery` | 25 min |
| N-38 | The chat imports `renderMarkdown` from `editor/PreviewPane.tsx`, dragging the whole markdown/PDF/diagram module graph into the chat chunk for one function. | P3 | CONFIRMED | `StepRows.tsx:6` | move `renderMarkdown` to `editor/markdown.ts` | 20 min |
| N-39 | `AutomationsPage.tsx` (760) has one clean split: `Detail` (`:532`) and `HermesRuns` (`:721`) take props only. | P3 | CONFIRMED | traced | move to `AutomationDetail.tsx` | 40 min |

## 4.7 New findings — `src/settings/`

| # | Finding | Severity | State | Evidence | Fix | Cost |
|---|---|---|---|---|---|---|
| N-40 | Two browser-only controls must go with the pane: General's "Open links in Kolux" (`GeneralPage.tsx:336`, writes `linksOpenInKolux`) and Terminal's "Open web links from the terminal in the Kolux browser" (`TerminalPage.tsx:222-225`). Both become visible switches nothing reads. | P1 | CONFIRMED | traced | delete with N-26; keep the system-browser wording only | 20 min |
| N-41 | A secret settings key exists only for the browser (`browserSearchSessionUrl`) and is exported, imported and listed in the lost-key notice. | P3 | CONFIRMED | `settingsSync.ts:10`, `KeyLostNotice.tsx:15` | drop it from `SECRET_KEYS` and the notice | 10 min |
| N-42 | Shortcut help still advertises a **Browser** area with 7 actions. | P3 | CONFIRMED | `shortcutRows.ts:9,40,47` | drop the `browser` area | 10 min |
| N-43 | Settings search returns entries for the removed controls. | P3 | CONFIRMED | `search.ts:19,63`; also `zoom.ts:3` mentions browser panes | rewrite the two entries | 10 min |

`src/settings/` is 10.2k lines across 82 files. A full dead-code/duplication pass there is
round-2 work, not done this pass; section 2 (F-11 to F-14) already covers the four items this
lane can act on today.

## 4.8 Severity counts for this second pass

| Severity | Count |
|---|---|
| **P0** | 1 (H-1: the update check depends on the browser module's HTTP client) |
| **P1** | 7 (L-1..L-3, H-2, H-3, N-01, N-15, N-26, N-40) |
| **P2** | 15 |
| **P3** | 20 |

## 4.9 Round-2 order for this lane

1. **Goal 0, my half** — it is the work other lanes are waiting on, in this order: move
   `notePdf.ts` to `editor/`, add `src/open/openExternal.ts` (one wrapper around the existing
   `open_external`, `src-tauri/src/artifacts.rs:1405`), repoint Checks (N-15), Ports (F-18),
   HTML preview (N-01) and chat links (N-26), delete the two settings controls (N-40), then
   delete `src/browser/` and its cards in one commit.
2. **Local loop** (L-1..L-4): the `[profile.local]` from c3-terminal, `scripts/local-run.mjs`,
   a shared `CARGO_TARGET_DIR`, and `docs/dev-loop.md` carrying the 4.1 table plus one new
   timed run proving the improvement.
3. **Correctness fixes that do not wait on the removal**: N-03 (per-tab 2 s poll + fence mutex),
   N-16 (Checks tab frozen on one status read), N-05/N-06 (render-path string building and
   re-flattening), N-07 (no right-click Copy anywhere), F-09 (delete the dead 1,367-line panel).
4. **Refactor seams**, one commit each: F-02 + N-08 + N-14 (one move), N-09, N-23, N-39, N-11.

## 4.10 Bug files filed this pass

| Owner | File | Why | New? |
|---|---|---|---|
| c3-terminal | `20261112-1143-browser-net-helpers-must-survive.md` | H-1..H-5: the update check, project icons and the Tower window live inside `browser*` | **new** — the 11:05 batch lists KEEPs but misses the update check, which is the P0 |
| c3-terminal | `20261112-1144-add-a-local-build-profile.md` | L-1: `[profile.local]` so `pnpm local` can exist | **new** |
| c3-terminal | `20261112-1147-right-sidebar-polls-behind-settings.md` | the right panel keeps polling behind a full-page screen (`Right.tsx:62` ignores `fullPage`) | **new** |

Everything else this pass found is either already filed by the 11:05 batch or is mine to fix.

## 4.11 Settings pass (added after the first commit of this section)

A dedicated pass over `src/settings/` (82 source files, 10.2k lines) found one P1 and nine more
items. This closes the gap noted in 4.7.

| # | Finding | Severity | State | Evidence | Fix | Cost |
|---|---|---|---|---|---|---|
| N-44 | **The "Removing a started session" setting does nothing.** The control writes `removeStartedSession`; the only reader chain is `readRemove` → `removePlan` (`terminal/remove.ts:41`), and `removePlan` has **zero non-test callers**. The real path (`terminal/paneActions.ts:112`) always asks, by design, and never reads settings. So choosing "Stop without asking" still asks. | **P1** | CONFIRMED | `TerminalPage.tsx:277-284` writes it; `grep removePlan src` → only `remove.ts:41`; `paneActions.ts:105-113` builds its question from `removeShortcutAsk` | either branch on `removePlan(settings, kind)` in `removeSession` (c3-terminal's file), or delete the control so the UI stops promising it | 30-45 min wired / 5 min deleted |
| N-45 | Settings **search mounts every matching page in full**, heavy work included: `ClaudeSetupPage` runs a full `claude_setup` disk scan, `TerminalPage` builds a real xterm sample, `GitPage` calls `scm_gh_budget` + `branch_prefix_check`, `AutoPrSettings` calls `project_list` plus one `workspace_list` per project. Typing "claude" costs a full setup scan to show a heading. | P2 | CONFIRMED | `SettingsPage.tsx:468` (`hits.pages.map(<PageBody …/>)`), `ClaudeSetupPage.tsx:400`, `TerminalPage.tsx:41-53`, `autoPr.tsx:99-102` | pass a `searching` flag and let the heavy cards skip their load while a search runs | 2-3 h |
| N-46 | The branch-prefix sample re-checks over IPC on **every keystroke** (the effect depends on the live input text). | P2 | CONFIRMED | `GitPage.tsx:188` with `typed = draft ?? settings.branchPrefixCustom` | wrap `typed` in the existing `useSettled` (`editor/settledQuery.ts`) | 15 min |
| N-47 | The same clamped-number draft field exists twice, nearly line for line (`DelayField` and `MinutesField`). | P2 | CONFIRMED | `GeneralPage.tsx:171`, `ExperimentalCard.tsx:8` | one `NumberDraftField` | 30 min |
| N-48 | Two copies of the "typed number, commit on Enter/blur/leave" control. | P2 | CONFIRMED | `TerminalPage.tsx:62` (`NumberField`), `InputCards.tsx:28` (`Lines`) | export `NumberField` and use it in `InputCards` | 30 min |
| N-49 | Four settings-write paths bypass the shared save turn (`saveInTurn`), so they can interleave with a page save and skip `tidySettings` (SET-035). | P2 | CONFIRMED | `useSettings.ts:33`, `SettingsPage.tsx:169`, `ClaudeAccounts.tsx:115`, `AppearancePage.tsx:592` | export `patchSettings(patch)` that hops onto `saveInTurn`; use it at the three call sites | 1 h |
| N-50 | Dead in full: `pickers.ts` (4 exports, test-only) plus five loose dead exports — `NEUTRAL` (`customTheme.ts:16`), `hasChanges` (`terminalImportRead.ts:40`), `autoSaver` and `hiddenWhitespace` (`editorPrefs.ts:55,59`), `openInItems` (`openIn.ts:62`, re-implemented at `scm/openWith.ts:13`). | P3 | CONFIRMED | grep across `src/` excluding tests | delete `pickers.ts` + test and the five exports (extends F-11) | 20 min |
| N-51 | `usageReads` is read by the panes but nothing in the app writes it — an orphan key only editable by hand in `settings.json`. | P3 | CONFIRMED | `usage/meter.ts:113`; no Settings control, no Rust writer | drop the `READS_FIELD` branch, keep `percentMode` | 10 min |
| N-52 | Real logic with no adjacent test: `CustomThemeEditor.tsx` (293, save/rename/duplicate/delete/import), `NotificationsPage.tsx` (187, volume draft + test flow), `ShortcutsPage.tsx` (208, the global key-recording capture), `GeneralPage.tsx` (360, no adjacent test at all). | P3 | CONFIRMED | only `__cards__/*` reach parts of `GeneralPage` | start with `ShortcutsPage` recording (it intercepts keys globally) | ~3 h |
| N-53 | The shortcuts list is re-filtered per area group on every render, with no debounce on the query. | P3 | CONFIRMED | `ShortcutsPage.tsx:33`, `:144` inside `AREAS.map` | two `useMemo`s (filtered rows, group-by-area) + `useSettled` | 15 min |

Largest settings files: `AppearancePage.tsx` 624, `SettingsPage.tsx` 488, `ClaudeSetupPage.tsx`
435, `importSchemes.ts` 429, `GeneralPage.tsx` 360.

**N-44 needs a cross-lane answer:** the control is mine (`TerminalPage.tsx`), the reader is
c3-terminal's (`terminal/remove.ts`, `terminal/paneActions.ts`). Filed as
`_shared/bugs/c3-terminal/20261112-1205-remove-started-session-setting-is-dead.md` — wire it, or
tell me to delete the control.

## Round 3 closures (2026-11-12)

| # | State | Where |
|---|---|---|
| N-01 | CLOSED by round 2: `htmlPreview.ts` opens the served address through `src/open/openExternal.ts`. | verified this round |
| N-15 | CLOSED by round 2: `ChecksPanel.tsx:156` runs `openOut(pr.url)` → `openExternal`. | verified this round |
| N-16 | FIXED `d5d771ea`: `PrStart` follows `watchStatus(dir)`, re-renders when the readiness answer goes stale, and reads once when nothing answers. | `src/scm/PrStart.tsx` |
| N-07 | FIXED `a5703046`: a text selection outside a field gets a Copy-only row; `runEdit` copies without focusing. | `src/editmenu/editMenuModel.ts`, `EditMenuHost.tsx` |
| N-04 | FIXED `979ecaf7`: the preview draws from the settled text (300 ms). | `src/editor/PreviewPane.tsx` |
| N-17 | FIXED `4b76b9e6`: the ports list is cleared only by a change of workspace. | `src/ports/PortsItem.tsx` |
| N-06 | FIXED `93f9719e`: the tree passes are memoised on what they read. | `src/editor/Explorer.tsx` |
| N-18 | NOT fixed: still two `git status` reads per Checks-tab open (Rust `scm_pr_checks` + the panel's seed read). The seed read stays because `scm_watch` sends no first status (its first read is after the 30 s safety tick). | `PrStart.tsx` + `src-tauri/src/scm_watch.rs:725` |

## Round 4 closures (2026-11-12)

| # | State | Where |
|---|---|---|
| N-03 | FIXED `01e62fad`: one `file_stamps` round for every visible tab, one interval and one window focus listener; a tab coming forward still checks at once. Before: one call (and one `fence.allow` worktree listing) per visible tab per 2 s. After: one for all of them. The gone/EDIT-032 wording stays per tab. | `src/editor/stampPoll.ts` (new) + `EditorPane.tsx` |
| N-05 | FIXED `f3497eaa`: `listSignature` compares what the pane draws plus Rust's per-file stamp instead of `JSON.stringify` of every file's old and new text, on the UI thread per watcher tick. | `src/editor/AllChangesPane.tsx` |
| N-11 | FIXED `a2c071d7`: `rail.ts`, `desktopDrops.ts` and `closeGuard.ts` use `buffers.ts` `keyOf`. WSL notes now match their file under either share name, and closing tabs no longer misses a file open under another spelling (an empty note could be deleted). `noteLinks.ts` already used it. | 3 files |
| N-20 | FIXED `4d02b88a`: the empty state's gating is `startPr.offerUi` (block reason, checking line, create label, one-click), tested for every branch in `startPr.test.ts`; `PrStart.test.ts` and `CommentsPanel.test.ts` render both panels (React server snapshot added to `prDraft`/`oneClick` so a panel can render without a DOM). The `act()` → `rowError` wire stays covered by `panelUx.test.ts`: no DOM environment exists for a click. | `startPr.ts`, `PrStart.tsx` |
| N-14 | FIXED `93809bb1`: `look` (the CodeMirror theme) moved to `src/editor/editorTheme.ts`, so the diff, All Changes and the disk banner no longer import the 900-line EditorPane for a style object (the build's cycle warning). | `editorTheme.ts` (new) |
| N-18 | Still open: two `git status` reads per Checks-tab open, as round 3 recorded. | — |

## Round 5 closures (2026-11-12)

| # | State | Where |
|---|---|---|
| N-19 | FIXED `a6aacc4a`: `panelUx.openInBrowser` is the one road for a panel link; ChecksPanel, StackMap and AutoPrStatus call it with their own note sink, so a refusal is worded once and cannot be dropped. A test drives both answers (opened → no note, refused → the words). | `src/scm/panelUx.ts` + 3 panels |
| N-46 | FIXED `a6aacc4a`: the branch-prefix sample follows `useSettled(typed)`, so Rust is asked about the prefix after a pause in typing, not on every keystroke. | `src/settings/GitPage.tsx` |
| N-49 | FIXED `9d3f7e6b`: `useSettings.patchSettings(patch)` exports the page save's own turn (read, merge into disk, tidy, read back); the setup card's resume switch, a Claude account's upkeep and the appearance flush use it. Three tests hold the merge, the tidy and the rejection. | `src/settings/useSettings.ts`, `SettingsPage.tsx`, `ClaudeAccounts.tsx`, `AppearancePage.tsx` |
| N-27 | FIXED `fd34fe85`: the composer's `commands` prop and the `reported` half of `commandsFor`/`menuFor` are gone — nothing ever passed them, so the session-command list was reachable only from a test. | `src/chat/MessageBox.tsx`, `complete.ts` |
| N-28 | FIXED `fd34fe85`: the automation dialog's `mode`/`base`/`runSetup` constants and `setupChoice` are gone; the saved input still says `existing`, `""`, `false`, so the back end sees what it saw. | `src/automations/AutomationDialog.tsx` |
| N-32 | FIXED `fd34fe85`: a Hermes/OpenClaw row action reads the automation list once (`refresh` already ends in `load`). | `src/automations/AutomationsPage.tsx` |
| N-39 | FIXED `8e12541c`: `Detail` and `HermesRuns` moved to `AutomationDetail.tsx`; the page is 761 → 529 lines, and the tests import `HermesRuns` from its new home. | `AutomationDetail.tsx` (new) |
| N-21 | FIXED `b783c5d7`: `scanWhileShown` stops the 3 s folder walk while the window is hidden and scans at once when it comes back; a scan failure is named once instead of swallowed. Three tests with fake timers. | `src/artifacts/ArtifactsPage.tsx` |
| N-40 | CLOSED earlier: neither General nor Terminal offers a link switch any more; the Terminal text says web links open in the user's own browser (verified by grep this round). | `src/settings/TerminalPage.tsx:222` |
| N-41 | CLOSED earlier: `browserSearchSessionUrl` appears nowhere in `src/`. | grep |
| N-44 | CLOSED by c3-terminal `a4671921`: `removeSession` consults `removePlan`, so "Stop without asking" is honoured. The control stays. | bug file in `_shared/bugs/done/` |

Still open after this round, in order: N-45 (settings search mounts every matching page — 2-3 h), N-30
(tests for five IPC-heavy components — 2 h), N-52/N-53 (settings tests, shortcuts list filtering), N-29
(chat re-render), N-47/N-48 (the two duplicate number fields), N-50 (dead exports), N-24, N-22, N-25, N-10,
N-12, N-42/N-43 (closed in round 4 / verified), N-37, N-38, N-31, N-33, N-34, N-35, N-36.
