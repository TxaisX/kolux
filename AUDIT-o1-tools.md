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
