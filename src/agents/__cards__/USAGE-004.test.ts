// USAGE-004 acceptance: the Agents rail footer (Claude 40% / 60% left) and the per-row context ring.
// MIRROR src/App.tsx:2287 (footer = usageLine(...readsLeft(settings))) and App.tsx:2284 (ringOf = context[p.key] ? ring : null);
// the figures and wording come from the real usageLine/readsLeft/contextFill/meterOf/meterText, the row from the real AgentsRail.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { ClaudeLimit } from "../../usage/claude";
import { capOn, codexOf, contextFill, meterOf, meterText, readsLeft, usageLine, type ContextReading } from "../../usage/meter";
import AgentsRail from "../AgentsRail";

const status = () => ({ word: "Idle", tone: "", explain: "" });
const now = new Date(2026, 9, 12, 12, 0, 0);
const at = new Date(2026, 9, 12, 15, 0, 0).getTime();
const claude: ClaudeLimit[] = [{ kind: "five_hour", usedPercent: 40, resetsAt: at }];

test("box 1: a Claude agent at 40% of its 5-hour window reads Claude 40% with a reset time; remaining reads 60%", () => {
  for (const settings of [{}, { usageReads: "used" }]) {
    expect(usageLine("claude", claude, null, readsLeft(settings), now)).toMatch(/^Claude 40% used · resets today (15|0?3)[:.]00/);
  }
  // the display switch in both of its settings keys (USAGE-025)
  for (const settings of [{ usageReads: "left" }, { usagePercentages: "remaining" }]) {
    expect(readsLeft(settings)).toBe(true);
    expect(usageLine("claude", claude, null, readsLeft(settings), now)).toMatch(/^Claude 60% left · resets today (15|0?3)[:.]00/);
  }
  const html = renderToStaticMarkup(
    createElement(AgentsRail, { groups: [{ id: "claude", name: "Claude", sessions: [{ key: 1, agent: "claude" }] }] as never, selected: 1, classic: false, statusOf: status as never, ringOf: () => null, footer: usageLine("claude", claude, null, true, now), onSelect: () => {}, onAdd: () => {}, onSettings: () => {} }),
  );
  expect(html).toContain('class="rail-foot"');
  expect(html).toMatch(/Claude 60% left · resets today/);
});

test("box 2: rows with a context reading show a ring, rows without one show none", () => {
  const context: Record<number, ContextReading> = { 1: { tokens: 100_000, window: 1_000_000 } };
  const settings = {};
  const ringOf = (p: { key: number; agent: string }) => (context[p.key] ? { percent: contextFill(context[p.key], capOn(settings)), title: meterText(meterOf(context[p.key], p.agent, claude, codexOf(p.agent, undefined, null, null), capOn(settings)) ?? {}) } : null);
  const html = renderToStaticMarkup(
    createElement(AgentsRail, {
      groups: [{ id: "claude", name: "Claude", sessions: [{ key: 1, agent: "claude" }, { key: 2, agent: "claude" }] }] as never,
      selected: 1,
      classic: false,
      statusOf: status as never,
      ringOf: ringOf as never,
      footer: "",
      onSelect: () => {},
      onAdd: () => {},
      onSettings: () => {},
    }),
  );
  const rows = html.split('data-session="').slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('class="ring');
  expect(rows[0]).toContain("Context 100k / 170k before auto handoff (59%)");
  expect(rows[1]).not.toContain("ring");
  expect((html.match(/<svg class="ring/g) ?? []).length).toBe(1);
});
