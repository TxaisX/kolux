// USAGE-001 acceptance: the pane header's context ring and percentage. Readings go through the real takeReading
// (per pane, newest wins), contextFill (the figure the header gets) and the real ContextGauge.
// MIRROR src/App.tsx:3203 context={context[p.key] ? contextFill(context[p.key], capOn(settings)) : null}.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { takeReading, type Reading } from "../../status/useAgentStatus";
import { capOn, contextFill } from "../../usage/meter";
import { ContextGauge } from "../UsageReadout";

const ev = (paneKey: number, tokens: number | null) => ({ paneKey, contextTokens: tokens, contextWindow: tokens === null ? null : 200_000 });
const header = (reading: Reading | undefined, agent = "claude") =>
  renderToStaticMarkup(createElement(ContextGauge, { context: reading ? contextFill(reading, capOn({})) : null, agent }));

test("box 1: a greyed 0% until the first report, then a tinted figure that grows with the conversation", () => {
  const before = header(undefined);
  expect(before).toContain('class="gauge none"');
  expect(before).toContain(">0%<");
  expect(before).toContain("nothing received yet");
  let shown: Reading | undefined;
  const seen: string[] = [];
  for (const tokens of [17_000, 76_500, 127_500, 161_500]) {
    shown = takeReading(shown, undefined, ev(1, tokens)) ?? shown;
    seen.push(header(shown));
  }
  expect(seen[0]).toContain('class="gauge"');
  expect(seen[0]).toContain(">10%<");
  expect(seen[1]).toContain(">45%<");
  expect(seen[2]).toContain('class="gauge warn"'); // 75%
  expect(seen[2]).toContain(">75%<");
  expect(seen[3]).toContain('class="gauge danger"'); // 95%
  expect(seen.some((h) => h.includes("nothing received yet"))).toBe(false);
});

test("box 2: beyond 90% of the window the ring and the number go red", () => {
  const html = header({ tokens: 158_100, window: 200_000 });
  expect(html).toContain('class="gauge danger"');
  expect(html).toContain(">93%<");
  expect(html).toContain('class="ring danger"');
  // exactly 90% is still yellow
  const edge = header({ tokens: 153_000, window: 200_000 });
  expect(edge).toContain('class="gauge warn"');
  expect(edge).toContain('class="ring warn"');
});

test("box 3: two Claude panes at different fill levels each show their own figure", () => {
  const readings: Record<number, Reading> = {};
  for (const [pane, tokens] of [[1, 34_000], [2, 156_400]] as const) {
    const r = takeReading(readings[pane], undefined, ev(pane, tokens));
    if (r) readings[pane] = r;
  }
  const one = header(readings[1]);
  const two = header(readings[2]);
  expect(one).toContain(">20%<");
  expect(one).toContain('class="gauge"');
  expect(two).toContain(">92%<");
  expect(two).toContain('class="gauge danger"');
  // a newer reading in pane 1 changes pane 1 only
  readings[1] = takeReading(readings[1], undefined, ev(1, 127_500)) ?? readings[1];
  expect(header(readings[1])).toContain(">75%<");
  expect(header(readings[2])).toContain(">92%<");
});
