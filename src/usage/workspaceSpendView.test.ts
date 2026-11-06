// @vitest-environment node
// Owner change 2026-11-06: the workspace spend ribbon's drawing, from in-memory rows only.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { WorkspaceSpendView, costText } from "./WorkspaceSpend";
import { localDay, type Row, type Usage } from "./tokens";
import { workspaceSpend } from "./workspaceRibbon";

const TODAY = new Date(2026, 10, 6, 12, 0, 0); // Friday 6 Nov 2026, local
const day = (back: number) => localDay(new Date(2026, 10, 6 - back));
const row = (p: Partial<Row> = {}): Row => ({
  day: day(0), session: "A", model: "claude-opus-4-5", cwd: "C:\\Work\\alpha", band: 0,
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 1, ...p,
});
const saved = (rows: Row[]) => ({ scannedAt: TODAY.getTime() - 30_000, rows, error: null });
const usage = (rows: Row[] = [row({ session: "A", input: 1_000_000 }), row({ session: "B", day: day(2), input: 234_567 })]): Usage => ({
  tracking: { claude: true, codex: false },
  claude: saved(rows),
  codex: null,
});
const view = (u: Usage = usage(), dir = "C:\\Work\\alpha") =>
  renderToStaticMarkup(createElement(WorkspaceSpendView, { spend: workspaceSpend(u, dir, TODAY), now: TODAY.getTime() }));

test("owner change 2026-11-06: the ribbon draws the workspace total, cost, today and the 14-day gauge", () => {
  const html = view();
  expect(html).toContain('class="strip-spend"');
  expect(html).toContain('role="group"');
  expect(html).toMatch(/aria-label="1,234,567 tokens in alpha across 2 sessions/);
  expect(html).toContain("<b>1.2M</b> tok");
  expect(html).toContain('class="strip-spend-cost"');
  expect(html).toContain("today");
  expect((html.match(/class="spend-bar/g) ?? []).length).toBe(14);
  expect(html).toContain('class="spend-bar has today"');
  expect(html).toContain("Estimated at list price");
  expect(html).not.toContain("strip-spend empty");
});

test("owner change 2026-11-06: the hover names the workspace, today, the week and each provider", () => {
  const html = view();
  expect(html).toContain("C:\\Work\\alpha");
  expect(html).toContain("Today:");
  expect(html).toContain("Last 7 days:");
  expect(html).toContain("Claude 1.2M tok");
  expect(html).toContain("Counted just now");
});

test("owner change 2026-11-06: a cost with an unpriced model reads as a floor, and one with no price at all reads n/a", () => {
  expect(costText({ tokens: 0, usd: 0, partial: false })).toBe("≈ $0.00");
  expect(costText({ tokens: 100, usd: 1.5, partial: true })).toBe("≥ $1.50");
  expect(costText({ tokens: 100, usd: 0, partial: true })).toBe("n/a");
  const odd = view(usage([row({ model: "mystery-9", input: 10 })]));
  expect(odd).toContain("n/a");
  expect(odd).toMatch(/aria-label="[^"]*a floor"/);
  expect(odd).toContain("Some models have no published price");
});

test("owner change 2026-11-06: an empty workspace keeps the ribbon and reads zero", () => {
  const html = view(usage([]), "C:\\Work\\alpha");
  expect(html).toContain('class="strip-spend empty"');
  expect(html).toContain("<b>0</b> tok");
  expect(html).toContain("≈ $0.00");
  expect(html).toContain("No token use recorded for this workspace yet.");
});

test("owner change 2026-11-06: tracking off is a way to turn it on, not a blank strip", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceSpendView, { spend: workspaceSpend({ tracking: { claude: false, codex: false }, claude: null, codex: null }, "C:\\Work\\alpha", TODAY) }));
  expect(html).toContain('class="strip-spend-off"');
  expect(html).toContain("Token tracking off");
});
