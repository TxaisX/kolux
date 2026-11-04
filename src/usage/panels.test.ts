import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { byModel, daily, filterRows, recentSessions, type Row, type Usage } from "./tokens";
import { TokenAnalyticsView } from "./TokenAnalytics";

// Invented figures and folders only.
const row = (day: string, p: Partial<Row> = {}): Row => ({ day, session: "s1", model: "claude-opus-4-5", cwd: "C:\\work\\app", band: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 0, ...p });
const today = new Date(2026, 2, 31);
const roots = ["C:/work/app", "D:\\kolux-workspaces"];

const rows = [
  row("2026-03-30", { input: 10 }),
  row("2026-03-20", { input: 100, cwd: "d:/kolux-workspaces/app/fix-login" }),
  row("2026-01-02", { input: 1000 }),
  row("2026-03-29", { input: 5000, cwd: "C:\\elsewhere", session: "outside" }),
];

test("USAGE-014: the range keeps the last 7, 30 or 90 local days or everything", () => {
  const sum = (r: Row[]) => r.reduce((t, x) => t + x.input, 0);
  expect(sum(filterRows(rows, { range: "7", scope: "all", roots, today }))).toBe(5010);
  expect(sum(filterRows(rows, { range: "30", scope: "all", roots, today }))).toBe(5110);
  expect(sum(filterRows(rows, { range: "90", scope: "all", roots, today }))).toBe(6110);
  expect(sum(filterRows(rows, { range: "all", scope: "all", roots, today }))).toBe(6110);
});

test("USAGE-014: Kolux scope keeps only use inside registered projects and their worktrees; outside-only history shows nothing", () => {
  const kolux = filterRows(rows, { range: "all", scope: "kolux", roots, today });
  expect(kolux.map((r) => r.input).sort((a, b) => a - b)).toEqual([10, 100, 1000]);
  expect(filterRows([row("2026-03-30", { cwd: "C:\\elsewhere", input: 9 })], { range: "all", scope: "kolux", roots, today })).toEqual([]);
  expect(filterRows([row("2026-03-30", { cwd: "C:\\elsewhere", input: 9 })], { range: "all", scope: "kolux", roots: [], today })).toEqual([]);
});

test("USAGE-014: the daily chart has one bar per local day of the range, and weeks for long histories", () => {
  const d = daily(filterRows(rows, { range: "7", scope: "all", roots, today }), "7", today);
  expect(d).toHaveLength(7);
  expect(d[d.length - 1]).toMatchObject({ day: "2026-03-31", tokens: 0 });
  expect(d.find((b) => b.day === "2026-03-29")?.tokens).toBe(5000);
  expect(daily([], "7", new Date(2026, 2, 31, 18, 30))).toHaveLength(7); // late in the day still seven bars
  const long = daily([row("2019-01-01", { input: 1 }), row("2026-03-30", { input: 2 })], "all", today);
  expect(long.length).toBeLessThan(400); // seven years of days drawn as weekly bars
  expect(long.reduce((t, b) => t + b.tokens, 0)).toBe(3);
});

test("USAGE-014: a session that used several models appears once under each; unknown prices read n/a, guessed ones inferred", () => {
  const r = [
    row("2026-03-30", { session: "a", model: "claude-opus-4-5", input: 10 }),
    row("2026-03-30", { session: "a", model: "claude-opus-4-5", input: 5, band: 1 }),
    row("2026-03-30", { session: "a", model: "opus", input: 7 }),
    row("2026-03-29", { session: "b", model: "claude-made-up", input: 3 }),
  ];
  const m = byModel("claude", r);
  expect(m.find((x) => x.model === "claude-opus-4-5")).toMatchObject({ tokens: 15, sessions: 1, price: "known" });
  expect(m.find((x) => x.model === "opus")).toMatchObject({ sessions: 1, price: "inferred" });
  expect(m.find((x) => x.model === "claude-made-up")).toMatchObject({ tokens: 3, price: "none" });
  const s = recentSessions("claude", r);
  expect(s.map((x) => x.session)).toEqual(["a", "b"]);
  expect(s[0].models).toEqual(["claude-opus-4-5", "opus"]);
  expect(s[0].tokens).toBe(22);
});

const usage = (claude: Row[]): Usage => ({ tracking: { claude: true, codex: false }, claude: { scannedAt: 1, rows: claude, error: null }, codex: null });
const view = (u: Usage, scope: "kolux" | "all", range: "7" | "30" | "90" | "all" = "30") =>
  renderToString(createElement(TokenAnalyticsView, { usage: u, pick: "claude", scanning: [], onPick: () => {}, onTrack: () => {}, onRefresh: () => {}, today, filters: { range, scope, roots }, onFilters: () => {} }));

test("USAGE-014: the Claude panel draws range and scope pickers, the day chart, models and recent sessions", () => {
  const html = view(usage([row("2026-03-30", { input: 1000, model: "claude-a-very-long-model-name-that-must-wrap-not-clip" })]), "kolux");
  expect(html).toContain("Last 30 days");
  expect(html).toContain("Kolux workspaces");
  expect(html).toContain("data-day-chart");
  expect(html).toContain("claude-a-very-long-model-name-that-must-wrap-not-clip");
  expect(html).toContain("Recent sessions");
  expect(html).toContain("n/a");
});

test("USAGE-014: Kolux scope with only outside use shows no data, every-use scope shows it", () => {
  const outside = usage([row("2026-03-30", { input: 4321, cwd: "C:\\elsewhere" })]);
  expect(view(outside, "kolux")).toContain("No use inside Kolux");
  expect(view(outside, "kolux")).not.toContain("4.3K");
  expect(view(outside, "all")).toContain("4.3K");
});
