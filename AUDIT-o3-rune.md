# Audit Report — Lane o3-rune (Round 1)

Scope audited (read-only; no code changed in Round 1):
- Owned TS/TSX/CSS areas: `src/usage/`, `src/insights/`, `src/notify/`, `src/i18n/`, `src/privacy/`, `src/feedback/`, `src/update/`, `src/crash.tsx`, `src/language.ts`, `src/glossary.ts`, `src/app-info.ts`
- Reference inspection for Round 2 Rune spike: `G:\Dev\rune-ref` (`anomalyco/rune` branch `dev`, pinned rev `c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3`) and `src-tauri/src/pty*.rs`

Baseline checks on Round 1 start:
- `npx tsc --noEmit`: pass (0 errors)
- `npx vitest run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update`: 45 files, 327 tests passed

---

## 1. Findings (Owned Codebase)

### [P1] CONFIRMED — Claude `resetsAt` unit mismatch (ms vs seconds) corrupts launch warnings and usage alert dates
- **Where**: `src/usage/launchWarn.ts:44-48` (consumed by `src/usage/launchWarn.ts:27` and `src/usage/alerts.ts:37`; fed by `src/usage/ClaudePill.tsx:25`)
- **What is wrong**:
  - `src-tauri/src/hooks.rs:524,2262-2263` produces `ClaudeLimit.resetsAt` in **Unix milliseconds** (e.g. `1_791_835_200_000`), and `src/usage/meter.ts:123` / `src/usage/claude.ts:13` treat `ClaudeLimit.resetsAt` as milliseconds (`w.resetsAt / 1000` before `resetWords`).
  - `src/usage/codex.ts:19-25` `resetWords(at)` expects **Unix seconds** (`new Date(at * 1000)`).
  - `claudeFigures()` in `src/usage/launchWarn.ts:46` copies `l.resetsAt` (milliseconds) verbatim into `ProviderUsage.{fiveHour,weekly}.resetsAt`, which `launchWarnings` (`launchWarn.ts:27`) and `dueAlerts` (`alerts.ts:37`) pass directly to `resetWords()`. That multiplies milliseconds by 1000, formatting dates in ~58,000 AD instead of today/weekday.
  - `src/usage/launchWarn.test.ts:5` masked the bug by defining its test helper `at` in seconds (`/ 1000`).
- **Fix**: Divide `l.resetsAt` by `1000` in `claudeFigures` (`l.resetsAt == null ? null : Math.round(l.resetsAt / 1000)`), update `launchWarn.test.ts` to use realistic millisecond `ClaudeLimit.resetsAt` values, and add a test asserting `resetWords` formats `"resets today"` from a millisecond `ClaudeLimit`.
- **Cost**: ~15 min.

### [P2] CONFIRMED — Goal 0: `src/privacy/hosts.test.ts` references removed embedded browser pane
- **Where**: `src/privacy/hosts.test.ts:63` (plus cross-lane dependency `src/settings/outbound.ts:11,22`, filed to `o1-tools`)
- **What is wrong**: `NOT_A_CONNECTION["127.0.0.1"]` reads `"this computer: the browser pane's own preview and port probe"`. Once `c3-terminal` deletes `src-tauri/src/browser*.rs` per Goal 0, `127.0.0.1` still remains in production code (`src-tauri/src/agent_hooks/vendors.rs:234` for Amp hook callbacks), so the reason text becomes inaccurate.
- **Fix**: Update `NOT_A_CONNECTION["127.0.0.1"]` in `src/privacy/hosts.test.ts:63` to describe the local agent hook callback listener (`agent_hooks/vendors.rs`) once the browser pane is removed (and coordinate with `o1-tools` on `src/settings/outbound.ts`).
- **Cost**: ~10 min.

### [P2] CONFIRMED — Language packs load asynchronously, but no UI subscribes to `onPackLoaded`
- **Where**: `src/i18n/lookup.ts:49-58`, `src/main.tsx:75`, `src/chrome/TopBar.tsx:145`, `src/sleep/AsleepPane.tsx:20-23`, `src/onboarding/Wizard.tsx:188`
- **What is wrong**: `t()` (`src/i18n/lookup.ts:57`) triggers `void loadPack(lang)` asynchronously on first read in a non-English locale and returns the English fallback immediately. `onPackLoaded` (`lookup.ts:49`) exists specifically so mounted UI re-renders once the pack arrives, but **zero non-test files** import or call `onPackLoaded` (and `main.tsx:75` only registers loaders without preloading the active locale). As a result, components rendered before the dynamic `import()` resolves stay stuck in English until an unrelated state update.
- **Fix**: Preload `await loadPack(locale())` during startup in `main.tsx` (or expose a small `useT` / `useLanguagePack` hook using `onPackLoaded` in `src/i18n/lookup.ts` for components using `t()`, without touching files outside ownership if `main.tsx` isn't ours — note `main.tsx` and `TopBar.tsx` are outside `o3-rune` ownership, so if a hook or `applyLanguage` preload is needed in `main.tsx`, file a small follow-up to `c1-coord` or export a hook from `src/i18n/lookup.ts`). Wait: `applyLanguage` in `src/language.ts:43` IS owned by `o3-rune`, or `lookup.ts` can expose `useI18n()`. Even better: `loadPack()` could also be triggered inside `registerBundledPacks()` when `locale() !== "en"`. Let's check exact timing in Round 2 and file a bug if `main.tsx`/`TopBar.tsx` need wiring.
- **Cost**: ~30 min.

### [P2] CONFIRMED — Stale machine translation in all 5 non-English i18n packs for `onboarding.connect.wait`
- **Where**: `src/i18n/packs/es.ts:27`, `src/i18n/packs/fr.ts:27`, `src/i18n/packs/ja.ts:27`, `src/i18n/packs/ko.ts:27`, `src/i18n/packs/zh-CN.ts:27` vs `src/i18n/en.ts:25`
- **What is wrong**: `en.ts:25` reads `"Connect an AI above to continue, or choose “I’ll do this later”."`, whereas all 5 packs still translate an older layout instruction (`"use the left button to do it later"` — e.g., `"usa el botón de la izquierda..."`, `"utilisez le bouton de gauche..."`, `"左のボタンで..."`, `"왼쪽 버튼으로..."`, `"用左侧的按钮..."`).
- **Fix**: Update `"onboarding.connect.wait"` in all 5 packs to match the current `"I’ll do this later"` wording (and verify `packJargon` still passes).
- **Cost**: ~15 min.

### [P2] CONFIRMED — Slow path: `pricing.ts` `resolve()` rebuilds table sets and runs regex/sort on every row
- **Where**: `src/usage/pricing.ts:93-108` (`costOf` at line 122 -> `priceOf` at line 112 -> `resolve`)
- **What is wrong**: Every call to `estimate()`, `byModel()`, `recentSessions()`, `overview()`, `totals()`, and `workspaceSpend()` calls `costOf()` per row. `resolve()` allocates `[...new Set(table.filter(...).map(...))]`, compiles two `new RegExp(...)` objects (`pricing.ts:79,81,100`), sorts candidate families, and filters `table` by `from <= day` on **every single row** (and `WorkspaceSpend` runs this ~3x per row every 15s for 14-day buckets + totals).
- **Fix**: Cache `(provider, model)` resolution for the default `TABLE` (and memoize `ids` per provider), and avoid recompiling static regexes inside `family()` / `resolve()`. Keep `table` parameter override working for tests.
- **Cost**: ~30 min.

### [P2] CONFIRMED — Duplicated usage/insights formatting and scan-eligibility helpers
- **Where**:
  - `dueForCount` (`src/insights/model.ts:170`) vs `dueForScan` (`src/usage/workspaceRibbon.ts:148`) — identical implementations.
  - `countedAt` (`src/insights/model.ts:161-165`) vs `scannedAt` (`src/usage/workspaceRibbon.ts:119-121`) — near-identical logic (note `countedAt` ignores providers with `.error`, while `workspaceRibbon.ts` checks `every(at > 0)`).
  - `folderOf` (`src/insights/model.ts:32-35`) vs `workspaceName` (`src/usage/workspaceRibbon.ts:59-62`) — identical behavior.
  - `compact`/`count`, `money`, `dayText`/`dayWords`, `ago` duplicated across `src/insights/InsightsPanel.tsx:25-26,41`, `src/usage/WorkspaceSpend.tsx:17-18,35-43`, `src/usage/TokenAnalytics.tsx:36-39`, `src/usage/shareCardData.ts:33-39`.
- **Fix**: Extract shared pure formatting/scan helpers inside `src/usage/` (e.g. `src/usage/format.ts` or in `tokens.ts`) and reuse them from `src/insights/` and `src/usage/`, preserving exact string outputs tested by existing suites.
- **Cost**: ~45 min.

### [P3] PLAUSIBLE — Failed language pack load sticks in `pending` forever
- **Where**: `src/i18n/lookup.ts:33-45`
- **What is wrong**: If `load()` rejects, `.then(..., () => ({}))` resolves `pending.get(lang)` to `{}` and leaves `packs.get(lang)` undefined. On every subsequent `t()` call in that language, `!pack` is still true (`lookup.ts:57`), so `loadPack(lang)` is invoked again repeatedly returning the cached empty promise without either caching `{}` or allowing retry.
- **Fix**: On failure, delete `pending.delete(lang)` (or cache `{}` in `packs` if intentional non-retry, or clear `pending` with a one-shot retry policy).
- **Cost**: ~10 min.

### [P3] PLAUSIBLE — Missing unmount (`alive`) guards on async IPC calls in usage/update/feedback views
- **Where**: `src/usage/Activity.tsx:43-45`, `src/usage/TokenAnalytics.tsx:319-358`, `src/update/UpdateCenterView.tsx:49-72`, `src/feedback/FeedbackDialog.tsx:71-74`
- **What is wrong**: Async `invoke()` promises resolve without checking whether the component is still mounted; in `FeedbackDialog.tsx:71-74`, `setCrash(crash)` also runs synchronously before `readFacts()` resolves, so rapid re-opens before `readFacts()` settles could pair the wrong `crash` flag with an earlier/later `open` dispatch.
- **Fix**: Add `alive` / sequence guards in `Activity`, `TokenAnalytics`, `UpdateCenterView`, and move `crash` into `FeedbackDialog`'s reducer (`Act` `"open"`) with a sequence check on `readFacts()`.
- **Cost**: ~30 min.

### [P3] PLAUSIBLE — Missing `type="button"` on several `<button>` elements and minor tooltip refresh lag
- **Where**:
  - `src/crash.tsx:38` (`ReportButton` — note `src/crash.test.ts:49` asserts exact HTML `'<button class="btn">Report</button>'`, so keep or update test together)
  - `src/feedback/FeedbackDialog.tsx:208,228,232`
  - `src/update/UpdateCenterView.tsx:269,297,300,327`
  - `src/usage/TokenAnalytics.tsx:93,257`
  - `src/usage/ClaudePill.tsx:62,65`: `useResetTick` ticks hourly when reset is >24h away, so `forecast` minute countdown (`lineFor`) in the hover tooltip can lag between status-line reports.
  - `src/usage/paneFigures.ts:40-50,108-117`: `runner` entries in `src/usage/refresh.ts:77` `states` Map are never removed on `stop()`.
- **Fix**: Add `type="button"` where safe (and adjust `crash.test.ts` if changing `ReportButton`), clean up `states` or document it, and optionally tick `ClaudePillView` every minute when a forecast `"at"` is active.
- **Cost**: ~20 min.

### [P3] CONFIRMED — Duplicated `.upd-*` CSS rules in `src/styles.css` vs `src/update/update.css`
- **Where**: `src/styles.css:1014-1036` (outside `o3-rune` ownership) vs `src/update/update.css:1-69`
- **What is wrong**: `src/update/update.css` documents that it overrides older `.upd-wrap` / `.upd-pop` rules in `src/styles.css`. `src/styles.css` still ships `.upd-wrap` / `.upd-card` / `.upd-pop` eagerly in the first-load CSS bundle (`src/contrast.test.ts:79` checks `.upd-card:focus-visible` in `styles.css`).
- **Fix**: Coordinator / CSS cleanup later (out of `o3-rune` file ownership).
- **Cost**: ~15 min (other lane / coordinator).

### File size & dead code check (owned area)
- **Files over ~800 lines**: None. Largest owned files are `src/update/UpdateCenterView.tsx` (355 lines) and `src/usage/TokenAnalytics.tsx` (350 lines).
- **Dead exports**: No completely dead modules found; `onPackLoaded` (`src/i18n/lookup.ts:49`) is exported and tested (`lookup.test.ts`) but has zero production callers (see P2 finding above).
- **Missing tests on risky paths**:
  - `src/usage/launchWarn.ts`: `claudeFigures` was only tested with seconds instead of millisecond `ClaudeLimit.resetsAt` values.
  - `src/usage/WorkspaceSpend.tsx` / `src/insights/InsightsPanel.tsx` / `src/usage/TokenAnalytics.tsx`: mount/timer/rescan effects are not exercised in unit tests (only pure view components and model functions are tested).
  - `src/feedback/FeedbackDialog.tsx`: `copyFirst` non-PNG conversion (`createImageBitmap` + `canvas.toBlob`) and rapid reopen during `readFacts()` are untested.

---

## 2. Rune Reference Audit & Round 2 Spike Plan (`spikes/rune-terminal/`)

- **Reference repo**: Cloned `https://github.com/anomalyco/rune` (`dev`) to `G:\Dev\rune-ref` (read-only), pinned at commit `c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3`. License: MIT, © Anomaly.
- **Windows & renderer readiness**:
  - `crates/rune` uses `wgpu` on Windows via `Backends::DX12` with `Dx12SwapchainKind::DxgiFromVisual` and `Dx12Compiler::Fxc` (`crates/rune/src/render.rs:584-616`), `DirectWrite` / `WindfoilChromium` text rasterization, `Family::Mono` (`crates/rune/src/text.rs:417`), and `rich(text, spans)` for styled monospace runs.
  - Headless tooling is built into `rune::run` / `AppSpec`: `--snap <png>`, `--tree <json>`, `--script <json>`, `--frames <n>`, `--size WxH`, `--scale S`, `--theme dark|light`.
- **Key gap discovered**: Rune (`crates/` and `rune-kit`) has **no built-in VT100/ANSI terminal widget or PTY driver**.
- **Round 2 spike architecture (`spikes/rune-terminal/`, standalone Cargo crate)**:
  1. Pin `rune = { git = "https://github.com/anomalyco/rune", rev = "c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3" }`.
  2. Reuse Kolux's PTY configuration (`portable-pty = "0.9"`, Windows shell chain / `fresh_terminal_path` / ConPTY sizing; evaluate direct path dep on `kolux_lib` vs extracting/mirroring `pty.rs` so the spike doesn't pull `tauri` + `webview2-com` if unnecessary).
  3. Add a Rust VT parser (`vt100` or `alacritty_terminal`) mapping grid rows/cells (fg/bg RGB/ANSI colours, bold/underline, cursor position) into Rune `El` panes (`Family::Mono`, `rich(line, spans)` + cursor rect) arranged in a 1 / 4 / 8-pane grid with keyboard input (`on_key` / `on_physical_input` -> PTY writer) and `AppSpec::poll` + `Waker` for live PTY output.
  4. Verify headlessly with `--snap` (1, 4, 8 panes) and `--tree`, then benchmark 8 panes live side-by-side against Kolux's WebView2 + xterm.js panes (memory, CPU %, GPU %, frame time, keystroke-to-screen) and write the 3-path proposal + any Rune issue drafts in `LANE-REPORT.md`.

### 2a. Rune capability check (round 1, second pass — CONFIRMED by reading the pinned tree)
- **No terminal support of any kind.** A scan of all 1,572 `.rs`/`.toml` files under `crates/`, `examples/` and `demo/` at rev `c9ae2f6` finds no PTY, no VT/ANSI parser, no alacritty/vte dependency (the one match is an unrelated `image_zoom.rs` test). A Rune terminal pane is 100% new code on Kolux's side.
- **What Rune does have** (so the spike is not blocked on the framework):
  - IME composition (`Ime::Commit`, `ime_cursor`, `set_ime`) — `crates/rune/README.md` around the text-input section.
  - Clipboard: text, CF_HTML on Windows, PNG images through `arboard`.
  - Text selection (`El::selection_group`, `Runtime::text_selection()`), monospace family (`Family::Mono`), DirectWrite / Windfoil / ClearType rasterisation on Windows.
  - Scroll viewports with virtualisation (`.virtualize` + `.growth`) — the shape a scrollback needs.
  - Headless tooling: `--snap`, `--tree`, `--script`, `--frames`, `--trace`, `--video`, `--keys`, `--pointer`, deterministic virtual clock, `rune::tooling::headless_run()` readable from inside the app.
- **Rune's own published performance figures** (Apple silicon, headless at 2×, from its README): 10.9 MB binary (9.3 MB stripped), frame CPU mean 0.13 ms / p95 0.29 ms over 180 frames of the Settings example, 174 instances in one draw call. **No Windows figures exist.** Treat these as Rune's numbers, not Kolux's; the round-2 spike must measure Windows.
- **What Kolux would have to match** (the real cost of a Rune terminal): the terminal area is 170 files — `src/terminal/TerminalPane.tsx` (2,169 lines), `paneActions.ts` (45 KB), plus `find`, `links`, `linkMenu`, `paste`, `copy`, `kittyKeys` (kitty keyboard protocol), `osc52`, `shellMarks`, `reattach`, `sessionFork`, `screenshotPaste`, `renderer`, `palette`, and xterm 6.0 with `addon-webgl`, `addon-ligatures`, `addon-fit`.

### 2b. [P2] CONFIRMED — a stale Vite transform cache makes the source-text tests fail on correct code
- **Where**: `node_modules/.vite/vitest` (cache), hit by the `?raw` imports in `src/usage/usageStatusUx.test.ts:17-18` and similar contract tests across the area.
- **What is wrong**: several tests assert on the *text* of a `.tsx` file (`import src from "./X.tsx?raw"`). After source files change, the cache can still serve the pre-change text, so the suite fails with "expected ... to contain `.finally(() => mounted.current && setLoading(false))`" while the file on disk plainly contains it. It cost this round two full-suite runs (~80 s) and nearly a wrong "the fix is broken" conclusion.
- **Evidence**: full area suite failed twice on `usageStatusUx.test.ts:44` and `:73`; the file on disk contained the expected text (`Get-FileHash` unchanged across 20 s); after deleting `node_modules/.vite/vitest` the same suite passed: `Tests 327 passed (327)`, exit 0.
- **Fix**: make the contract tests robust rather than cache-dependent — read the file with `node:fs` (the pattern already used for `src/styles.css` in the same file, `usageStatusUx.test.ts:20-21`) instead of `?raw`, or have CI clear `node_modules/.vite` before the run. Owned by o2-tests for the CI half; the `?raw` → `readFileSync` swap is inside o3-rune.
- **Cost**: ~20 min for the `?raw` swap in this area, ~5 min for a CI cache clear.

---

## 3. Status of the round-1 findings (as the tree stands at the end of round 1)

Fixes for six findings were found uncommitted in the worktree (written by an earlier/parallel session in this lane, not by this round's audit): P1 `launchWarn` ms→s, P2 `hosts.test.ts` wording, P2 stale `onboarding.connect.wait` in 5 packs, P2 `pricing.ts` index + memo, P3 `lookup.ts` retry, P3 unmount guards in `Activity` / `TokenAnalytics` / `UpdateCenterView` plus `type="button"`.

Verified on that tree, this round:
- `node node_modules/typescript/bin/tsc --noEmit` → exit 0.
- `node node_modules/vitest/vitest.mjs run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update` → `Tests 327 passed (327)`, exit 0 (after the cache clear in 2b).
- One stale assertion pair in `src/usage/usageStatusUx.test.ts` was updated to the guarded source (`.finally(() => mounted.current && setLoading(false))`, and the `alive` guard in the scope `catch`), which is the only code edit this round made.

Still open after round 1: P2 i18n preload (`onPackLoaded` has no production subscriber), P2 duplicated helpers between `src/usage/` and `src/insights/`, P3 tooltip tick, P3 `.upd-*` CSS duplication (not owned), and 2b above.
