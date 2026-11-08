import { expect, test, vi, afterEach } from "vitest";
import { costText, hoverLines, piecesFor, planFigure, readoutOf, startTicker, tokensText, windowsOf, FULL_WIDTH, type PlanWindow } from "./headerUsage";
import type { ClaudeLimit } from "../usage/claude";
import type { CodexUsage } from "../usage/codex";

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const claude: ClaudeLimit[] = [
  { kind: "five_hour", usedPercent: 34, resetsAt: NOW + (2 * 60 + 10) * 60_000 },
  { kind: "seven_day", usedPercent: 61, resetsAt: NOW + (3 * 24 + 4) * 3_600_000 },
];

afterEach(() => vi.useRealTimers());

test("USAGE-034: a Claude pane's plan windows are the 5-hour and the weekly one, in that order, with their reset times in ms", () => {
  const w = windowsOf("claude", claude, null);
  expect(w.map((x) => [x.label, x.usedPercent, x.resetsAt])).toEqual([
    ["5h", 34, NOW + 130 * 60_000],
    ["wk", 61, NOW + (3 * 24 + 4) * 3_600_000],
  ]);
  // A window the report has not named is left out, not shown as 0.
  expect(windowsOf("claude", [claude[1]], null).map((x) => x.label)).toEqual(["wk"]);
  expect(windowsOf("claude", [], null)).toEqual([]);
});

test("USAGE-034: a Codex pane shows Codex's own windows (seconds turned to ms); a shell shows none", () => {
  const codex: CodexUsage = { state: "ok", fiveHour: { usedPercent: 12, resetsAt: 1_000, windowMins: 300 }, weekly: { usedPercent: 40, resetsAt: null, windowMins: 10080 }, resetCredits: null, plan: null, message: null };
  expect(windowsOf("codex", claude, codex).map((x) => [x.label, x.usedPercent, x.resetsAt])).toEqual([["5h", 12, 1_000_000], ["wk", 40, null]]);
  expect(windowsOf("codex", claude, null)).toEqual([]);
  expect(windowsOf("shell", claude, codex)).toEqual([]);
});

test("USAGE-034: the plan figure follows the used-or-left choice, and its tint always follows how much is used", () => {
  const w: PlanWindow = { label: "wk", name: "Weekly", usedPercent: 91.2, resetsAt: null };
  expect(planFigure(w, false)).toEqual({ text: "91%", tone: "danger" });
  expect(planFigure(w, true)).toEqual({ text: "9%", tone: "danger" });
  expect(planFigure({ ...w, usedPercent: 34 }, false)).toEqual({ text: "34%", tone: "" });
  expect(planFigure({ ...w, usedPercent: 70 }, true)).toEqual({ text: "30%", tone: "warn" });
  expect(planFigure({ ...w, usedPercent: 90 }, false).tone).toBe("warn");
  expect(planFigure({ ...w, usedPercent: Number.NaN }, false)).toEqual({ text: "0%", tone: "" });
});

test("USAGE-034: tokens read used / window, and cost reads dollars with two decimals", () => {
  expect(tokensText(155_000, 200_000)).toBe("155k/200k");
  expect(tokensText(950, 200_000)).toBe("950/200k");
  expect(tokensText(1_300_000, 1_000_000)).toBe("1.3M/1M");
  expect(costText(3.15)).toBe("$3.15");
  expect(costText(0)).toBe("$0.00");
  expect(costText(3.149)).toBe("$3.15");
  expect(costText(12)).toBe("$12.00");
  // No report yet, or a broken figure, is no chip.
  expect(costText(null)).toBeNull();
  expect(costText(undefined)).toBeNull();
  expect(costText(Number.NaN)).toBeNull();
  expect(costText(-1)).toBeNull();
});

test("USAGE-034: the readout measures against the 170k auto handoff point (owner change 2026-11-07)", () => {
  expect(readoutOf({ tokens: 155_000, window: 1_000_000, costUsd: 3.15 }, true, false)).toEqual({ tokens: 155_000, window: 170_000, costUsd: 3.15, left: false });
  expect(readoutOf({ tokens: 155_000, window: 1_000_000 }, false, true)).toEqual({ tokens: 155_000, window: 170_000, costUsd: null, left: true });
  expect(readoutOf(undefined, true, false)).toEqual({ tokens: null, window: 170_000, costUsd: null, left: false });
});

const have = { tokens: true, windows: 2, cost: true };

test("USAGE-034: a wide header shows all five pieces", () => {
  expect(piecesFor(FULL_WIDTH, have)).toEqual({ tokens: true, plan: true, countdowns: true, cost: true });
  expect(piecesFor(5000, have)).toEqual({ tokens: true, plan: true, countdowns: true, cost: true });
});

test("USAGE-034: shrinking the header drops the cost, then the countdowns, then the plan figures, then the tokens", () => {
  const order: string[] = [];
  let last = piecesFor(FULL_WIDTH, have);
  for (let w = FULL_WIDTH; w >= 0; w -= 1) {
    const now = piecesFor(w, have);
    for (const k of ["cost", "countdowns", "plan", "tokens"] as const) if (last[k] && !now[k]) order.push(k);
    // Never a piece back that a wider header had dropped, and never a countdown without its figure.
    for (const k of ["cost", "countdowns", "plan", "tokens"] as const) if (!last[k]) expect(now[k]).toBe(false);
    if (now.countdowns) expect(now.plan).toBe(true);
    last = now;
  }
  expect(order).toEqual(["cost", "countdowns", "plan", "tokens"]);
  // At the narrowest only the ring and percentage remain.
  expect(piecesFor(0, have)).toEqual({ tokens: false, plan: false, countdowns: false, cost: false });
});

test("USAGE-034: a piece with nothing to show is never counted against the width", () => {
  // No cost yet: the countdowns survive at a width where the cost chip would have pushed them out.
  const w = FULL_WIDTH - 1;
  expect(piecesFor(w, have).cost).toBe(false);
  expect(piecesFor(w, { ...have, cost: false })).toEqual({ tokens: true, plan: true, countdowns: true, cost: false });
  expect(piecesFor(FULL_WIDTH, { tokens: false, windows: 0, cost: false })).toEqual({ tokens: false, plan: false, countdowns: false, cost: false });
  // One window only is narrower than two.
  expect(piecesFor(FULL_WIDTH - 110, { ...have, windows: 1 })).toEqual({ tokens: true, plan: true, countdowns: true, cost: true });
  expect(piecesFor(FULL_WIDTH - 110, have).cost).toBe(false);
});

test("USAGE-034: with no measurement yet every piece shows (nothing to measure, nothing to drop)", () => {
  expect(piecesFor(undefined, have)).toEqual({ tokens: true, plan: true, countdowns: true, cost: true });
});

test("USAGE-034: the hover gains one line per window naming its reset time", () => {
  const w = windowsOf("claude", claude, null);
  const lines = hoverLines("Context used: 78% of the agent's context window", w, false, new Date(NOW));
  expect(lines[0]).toBe("Context used: 78% of the agent's context window");
  expect(lines).toHaveLength(3);
  expect(lines[1]).toMatch(/^5-hour: 34% used, resets /);
  expect(lines[2]).toMatch(/^Weekly: 61% used, resets /);
  // 5-hour resets later the same day: no weekday; the weekly one is days away: names a weekday.
  expect(lines[1]).toMatch(/resets \d{1,2}:\d{2}\s?(AM|PM)?$/i);
  expect(lines[2]).toMatch(/resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w* \d{1,2}:\d{2}/);
  expect(hoverLines("t", w, true, new Date(NOW))[1]).toMatch(/^5-hour: 66% left, resets /);
  expect(hoverLines("t", [{ label: "5h", name: "5-hour", usedPercent: 10, resetsAt: null }], false, new Date(NOW))[1]).toBe("5-hour: 10% used, reset time unknown");
});

test("USAGE-034: the ticker moves the clock at least every 30 seconds and stops when cleared", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const seen: number[] = [];
  const stop = startTicker((t) => seen.push(t));
  vi.advanceTimersByTime(29_999);
  expect(seen).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(seen).toEqual([NOW + 30_000]);
  vi.advanceTimersByTime(60_000);
  expect(seen).toHaveLength(3);
  stop();
  vi.advanceTimersByTime(120_000);
  expect(seen).toHaveLength(3);
});

test("USAGE-034: with no plan windows nothing but the ring is drawn, at any width", () => {
  const none = { tokens: false, plan: false, countdowns: false, cost: false };
  expect(piecesFor(FULL_WIDTH, { tokens: true, windows: 0, cost: true })).toEqual(none);
  expect(piecesFor(undefined, { tokens: true, windows: 0, cost: true })).toEqual(none);
});
