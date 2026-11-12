# Lane Report — o3-rune

- **Status (plain words, 3 lines max)**:
  Round 1 audit complete (read-only, no code changes). Found 1 P1 runtime unit-mismatch bug in Claude usage warnings/alerts, 4 P2 issues (including browser-pane references in Privacy and stale/unsubscribed i18n packs), and 3 P3 polish/cleanup items. Cloned Rune (`dev` rev `c9ae2f6`) to `G:\Dev\rune-ref` and mapped out the Round 2 `spikes/rune-terminal/` architecture and gaps.

- **Done this round**:
  - Merged `integrate/wave-1` (already up to date) and installed workspace dependencies (`pnpm install`).
  - Verified baseline TypeScript and area tests:
    - `npx tsc --noEmit` → exit 0 (0 errors)
    - `npx vitest run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update` → `Test Files  45 passed (45)` / `Tests  327 passed (327)`
  - Audited all owned files (`src/usage/`, `src/insights/`, `src/notify/`, `src/i18n/`, `src/privacy/`, `src/feedback/`, `src/update/`, `src/crash.tsx`, `src/language.ts`, `src/glossary.ts`, `src/app-info.ts`) and wrote `AUDIT-o3-rune.md`.
  - Checked Goal 0 embedded-browser dependencies: noted `src/privacy/hosts.test.ts:63` for Round 2 update and filed `G:\Dev\kolux-lanes\_shared\bugs\o1-tools\20261112-1102-outbound-browser-pane-rows.md` for `src/settings/outbound.ts:11,22`.
  - Cloned `https://github.com/anomalyco/rune` (`dev`) to `G:\Dev\rune-ref` (read-only, rev `c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3`), read `crates/rune/README.md`, `crates/rune-kit/README.md`, `examples/hello`, `examples/cursed-settings`, and inspected Kolux's `src-tauri/src/pty.rs`.

- **Next round**:
  1. Fix queued bugs first, then `AUDIT-o3-rune.md` findings: P1 Claude `resetsAt` ms-vs-seconds bug in `src/usage/launchWarn.ts`, P2 `src/privacy/hosts.test.ts:63` browser-pane note, P2 stale `onboarding.connect.wait` in `src/i18n/packs/*.ts`, P2 `pricing.ts` `resolve()` memoization, and P2/P3 refactors (merging duplicated `src/usage/` + `src/insights/` helpers).
  2. Build `spikes/rune-terminal/` (standalone Cargo crate pinned to Rune rev `c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3` + PTY + VT parser + 1/4/8-pane grid with typing, colours, and cursor).
  3. Capture headless `--snap` PNGs (1, 4, 8 panes) + `--tree` dump, run the 8-pane live comparison vs Kolux WebView2 panes, and write the 3-path proposal + any Rune issue drafts in `LANE-REPORT.md`.

- **For the coordinator**:
  - Filed `G:\Dev\kolux-lanes\_shared\bugs\o1-tools\20261112-1102-outbound-browser-pane-rows.md` for `src/settings/outbound.ts:11,22` referencing the removed embedded browser pane.
  - Note for i18n (`src/i18n/lookup.ts:49`): `onPackLoaded` has no production subscribers in `src/main.tsx` / `src/chrome/TopBar.tsx` / `src/onboarding/Wizard.tsx` / `src/sleep/AsleepPane.tsx`; will check whether preloading in `registerBundledPacks()` or filing a cross-lane bug is cleanest in Round 2.
  - Note for `src/styles.css:1014-1036`: eager `.upd-*` CSS rules duplicate/are overridden by `src/update/update.css`.
