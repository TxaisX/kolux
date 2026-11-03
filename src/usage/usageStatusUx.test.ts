// @vitest-environment node
// UX audit findings/usage-status.md rows 3, 4, 7, 9, 10, 15, 16, 17 and 18 (the Usage side). Invented figures only.
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
const useDialogFocus = vi.fn();
vi.mock("../chrome/dialogFocus", () => ({ useDialogFocus: (...a: unknown[]) => useDialogFocus(...a) }));

import { loadFailedText, scanFailedNote, scopeFailedNote, trackFailedNote } from "./analyticsNotes";
import ShareButton from "./ShareButton";
import ShareCard from "./ShareCard";
import { TotalsView } from "./StripTotals";
import { LoadFailed, TokenAnalyticsView, figureLabel } from "./TokenAnalytics";
import analyticsSource from "./TokenAnalytics.tsx?raw";
import shareCardSource from "./ShareCard.tsx?raw";
import type { Row, Usage } from "./tokens";

const row = (day: string, p: Partial<Row> = {}): Row => ({ day, session: "s1", model: "claude-opus-4-5", cwd: "C:\\work\\app", band: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 0, ...p });
const today = new Date(2026, 2, 31);
const usage = (tracking = true): Usage => ({ tracking: { claude: tracking, codex: false }, claude: { scannedAt: 1, rows: [row("2026-03-30", { input: 1234 })], error: null }, codex: null });
const view = (extra: Record<string, unknown> = {}, pick: "claude" | "overview" = "claude") =>
  renderToStaticMarkup(createElement(TokenAnalyticsView, { usage: usage(), pick, scanning: [], onPick: () => {}, onTrack: () => {}, onRefresh: () => {}, today, filters: { range: "30", scope: "all", roots: [] }, onFilters: () => {}, ...extra }));

beforeEach(() => useDialogFocus.mockClear());

test("usage-status.md:3: a token_usage failure draws the error and a Retry button, not nothing", () => {
  const html = renderToStaticMarkup(createElement(LoadFailed, { error: "db locked", onRetry: () => {} }));
  expect(html).toContain(loadFailedText("db locked"));
  expect(html).toContain('role="alert"');
  expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
  expect(analyticsSource).toContain("<LoadFailed error={loadError} onRetry={load} />");
  // Retry keeps the error on screen until the read works, instead of blanking the panel while it runs
  expect(analyticsSource).toContain("then((u) => { setUsage(u); setLoadError(\"\"); }");
  expect(analyticsSource).not.toMatch(/setLoadError\(""\);\s*invoke/);
});

test("usage-status.md:4: a Track switch that fails says so, and the view draws the notice", () => {
  expect(trackFailedNote("claude", true, "no db")).toContain("Could not turn Claude token tracking on (no db)");
  const html = view({ notices: [trackFailedNote("claude", true, "no db")] });
  expect(html).toContain("data-ta-notice");
  expect(html).toContain("Could not turn Claude token tracking on");
  expect(view()).not.toContain("data-ta-notice");
  // the live region is there before any notice, so one that appears in it is announced
  expect(view()).toContain('<div role="status"></div>');
  expect(html).toMatch(/<div role="status"><p[^>]*data-ta-notice/);
  // no failure of token_usage, token_tracking_set or a rescan is swallowed any more
  expect(analyticsSource).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  expect(analyticsSource).not.toContain("setUsage, () => {}");
  expect(analyticsSource).toContain('note("track", trackFailedNote(p, on, e))');
});

test("usage-status.md:10: a failed rescan and an unreadable project list are named, and the scope falls back to every local use", () => {
  expect(scanFailedNote("codex", "timeout")).toBe("Could not rescan Codex's logs (timeout); the figures shown are the last saved ones.");
  expect(scopeFailedNote("offline")).toContain("every local use is shown");
  expect(analyticsSource).toContain("scanFailedNote(p, e)");
  expect(analyticsSource).toMatch(/\.catch\(\(e\) => \{\s*setFilters\(\(f\) => \(\{ \.\.\.f, scope: "all" \}\)\);\s*note\("scope", scopeFailedNote\(e\)\);/);
});

test("usage-status.md:7: the Share on X button uses the shared .btn class, which has CSS", () => {
  const html = renderToStaticMarkup(createElement(ShareButton, { onShare: () => {} }));
  expect(html).toContain('class="btn"');
  expect(html).not.toContain("usage-share");
});

test("usage-status.md:9: the Share dialog takes focus, traps Tab and restores it through the shared helper, with Escape closing it", () => {
  const onClose = vi.fn();
  renderToString(createElement(ShareCard, { provider: "claude", rows: [row("2026-03-30", { input: 5 })], range: "30", today, onClose }));
  expect(useDialogFocus).toHaveBeenCalledTimes(1);
  expect(useDialogFocus.mock.calls[0][1]).toBe(onClose);
  expect(shareCardSource).not.toContain('"Escape"'); // the dialog's own window listener is gone
});

test("usage-status.md:15: the strip totals' label sits on an element that can carry one (role group)", () => {
  const html = renderToStaticMarkup(createElement(TotalsView, { usage: usage() }));
  expect(html).toMatch(/<span class="strip-totals" role="group"[^>]*aria-label="1,234 tokens across 1 provider"/);
});

test("usage-status.md:16: the switch is labelled with what it tracks", () => {
  expect(view()).toContain("Track Claude tokens");
});

test("usage-status.md:17: the heatmap cells and the chart bars carry their figures as labels, not only as tooltips", () => {
  const label = figureLabel("2026-03-30", 1234);
  expect(label).toMatch(/Mar 30, 2026: 1\.2K tokens/);
  const chart = view();
  expect(chart).toContain(`role="img" aria-label="${label}"`); // a bar
  expect(chart).not.toContain('data-day-chart="true" role="img"'); // the parent is a group now, so the bars' labels are read
  const overview = view({}, "overview");
  expect(overview).toContain(`role="img" aria-label="${label}"`); // a heatmap cell
  expect(overview).toContain('data-activity-grid="true" role="group"');
});

test("usage-status.md:18: the panels get one stable today and a memoised row list, not a new Date on every render", () => {
  expect(analyticsSource).not.toContain("today={new Date()}");
  expect(analyticsSource).toContain("useMemo(() => new Date(), [usage, pick])");
  expect(analyticsSource).toContain("useMemo(() => filterRows(rowsOf(usage, p)");
});
