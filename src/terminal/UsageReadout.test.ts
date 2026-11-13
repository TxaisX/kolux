import { expect, test, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeaderUsage, UsageReadoutView } from "./UsageReadout";
import { FULL_WIDTH, windowsOf, type Readout } from "./headerUsage";
import { publishClaude } from "../usage/plan";

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const windows = windowsOf("claude", [
  { kind: "five_hour", usedPercent: 34, resetsAt: NOW + 130 * 60_000 },
  { kind: "seven_day", usedPercent: 91, resetsAt: NOW + (3 * 24 + 4) * 3_600_000 },
], null);
const readout: Readout = { tokens: 155_000, window: 200_000, costUsd: 3.15, left: false };

const view = (over: Partial<Parameters<typeof UsageReadoutView>[0]> = {}) =>
  renderToStaticMarkup(createElement(UsageReadoutView, { readout, windows, width: FULL_WIDTH, now: NOW, ...over }));

afterEach(() => publishClaude([]));

test("USAGE-034: a wide Claude pane shows tokens, both plan figures with countdowns, and the cost chip", () => {
  const html = view();
  expect(html).not.toContain("gauge");
  expect(html).toContain("155k/200k");
  expect(html).toContain("5h 34%");
  expect(html).toContain("· 2h 10m");
  expect(html).toContain("wk 91%");
  expect(html).toContain("· 3d 4h");
  expect(html).toContain('class="usage-cost"');
  expect(html).toContain("$3.15");
});

test("USAGE-034: each plan figure is tinted on its own: 34% plain, 91% red", () => {
  const html = view();
  expect(html).toContain('<span class="usage-fig">5h 34%');
  expect(html).toContain('<span class="usage-fig danger">wk 91%');
  // Countdowns and the token count carry no tint class.
  expect(html).toContain('<span class="usage-count">');
  expect(html).toContain('<span class="usage-tokens"');
});

test("USAGE-034: the plan figures follow used-or-left, the tint still follows used", () => {
  const html = view({ readout: { ...readout, left: true } });
  expect(html).toContain("5h 66%");
  expect(html).toContain('<span class="usage-fig danger">wk 9%');
});

test("USAGE-034: the hover has one line per window", () => {
  const html = view();
  expect(html).toMatch(/title="5-hour: 34% used, resets [^\n]*\nWeekly: 91% used, resets [^"]*"/);
});

test("USAGE-034: no cost report yet is no chip", () => {
  expect(view({ readout: { ...readout, costUsd: null } })).not.toContain("usage-cost");
});

test("USAGE-034: a window with no reset time shows its figure without a countdown", () => {
  const html = view({ windows: [{ label: "5h", name: "5-hour", usedPercent: 10, resetsAt: null }] });
  expect(html).toContain("5h 10%");
  expect(html).not.toContain("usage-count");
});

test("USAGE-034: a countdown past its time reads now", () => {
  const html = view({ windows: [{ label: "5h", name: "5-hour", usedPercent: 10, resetsAt: NOW - 1 }] });
  expect(html).toContain("· now");
});

test("USAGE-034: the countdown moves with the clock the wrapper hands the view", () => {
  expect(view({ now: NOW })).toContain("· 2h 10m");
  expect(view({ now: NOW + 5 * 60_000 })).toContain("· 2h 5m");
});

test("USAGE-034: narrowing the header drops the cost, then the countdowns, then the plan figures, then the tokens", () => {
  const steps = [FULL_WIDTH, FULL_WIDTH - 1, 640, 540, 0];
  const seen = steps.map((width) => {
    const h = view({ width });
    return [h.includes("usage-cost"), h.includes("usage-count"), h.includes("usage-fig"), h.includes("usage-tokens")];
  });
  expect(seen[0]).toEqual([true, true, true, true]);
  expect(seen[1]).toEqual([false, true, true, true]);
  expect(seen[2]).toEqual([false, false, true, true]);
  expect(seen[3]).toEqual([false, false, false, true]);
  // At the very narrowest nothing remains.
  expect(seen[4]).toEqual([false, false, false, false]);
  expect(view({ width: 0 })).toBe("");
  // Each step only ever loses pieces.
  for (let i = 1; i < seen.length; i++) seen[i].forEach((on, k) => on && expect(seen[i - 1][k]).toBe(true));
});

test("USAGE-034: before the first report the plan figures still show", () => {
  const html = view({ readout: { ...readout, tokens: null, costUsd: null } });
  expect(html).toContain("5h 34%");
  expect(html).not.toContain("usage-tokens");
  expect(html).not.toContain("usage-cost");
});

test("USAGE-034: the wrapper reads the account's plan windows from the shared store, the same for every pane", () => {
  publishClaude([{ kind: "five_hour", usedPercent: 50, resetsAt: Date.now() + 3_600_000 }]);
  const a = renderToStaticMarkup(createElement(HeaderUsage, { agent: "claude", readout: { ...readout, tokens: 20_000, costUsd: 0.5 } }));
  const b = renderToStaticMarkup(createElement(HeaderUsage, { agent: "claude", readout: { ...readout, tokens: 160_000, costUsd: 9 } }));
  // Own context and cost per pane.
  expect(a).toContain("20k/200k");
  expect(a).toContain("$0.50");
  expect(b).toContain("160k/200k");
  expect(b).toContain("$9.00");
  // The same plan figure on both.
  expect(a).toContain("5h 50%");
  expect(b).toContain("5h 50%");
  // A shell pane has no windows.
  expect(renderToStaticMarkup(createElement(HeaderUsage, { agent: "shell", readout: { ...readout, tokens: null, costUsd: null } }))).not.toContain("usage-win");
});

// Stand-in review of lane/marks b08c624c, FIX-SOON 1: the card (spec 06, USAGE-034) says a pane with
// no plan figures shows only the gauge (the gauge itself was removed 2026-11-12). Decision recorded in STATE-history.md; the revert is the guard in piecesFor plus this test and headerUsage.test.ts's, not one line.
test("USAGE-034: a pane with no plan windows shows no readout, no tokens and no cost", () => {
  const bare = view({ windows: [] });
  expect(bare).toBe("");
  expect(bare).not.toContain("usage-tokens");
  expect(bare).not.toContain("usage-cost");
  expect(bare).not.toContain("usage-win");
});
