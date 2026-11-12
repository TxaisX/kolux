// TERM-019 acceptance: every pane draws its own header with who is running, the session name and the usage.
// Renders the real TerminalPane (server render: the header is drawn before any effect runs).
// 2026-11-12: the context ring and percentage (USAGE-001) were removed from the header; the usage
// the header carries is the USAGE-034 readout (tokens, plan figures, cost), so the boxes read that.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import TerminalPane from "../TerminalPane";
import { readoutOf } from "../headerUsage";
import { publishClaude } from "../../usage/plan";

const pane = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(TerminalPane as never, { onClose: () => {}, ...props }));
const headerOf = (html: string) => html.match(/<header class="pane-head"[\s\S]*?<\/header>/)?.[0] ?? "";
const tokens = (header: string) => header.match(/class="usage-tokens"[^>]*>([^<]+)</)?.[1];

afterEach(() => publishClaude([]));

test("box 1: a single-pane grid still shows the header, with the program, the session name and the usage", () => {
  publishClaude([{ kind: "five_hour", usedPercent: 20, resetsAt: Date.now() + 3_600_000 }]);
  const usage = readoutOf({ tokens: 84_000, window: 200_000 }, false, false);
  const html = pane({ agent: "claude", cwd: "C:/work/app", usage, expand: { on: false, can: false, toggle: () => {} } }); // a lone pane: nothing to split from or expand into
  const head = headerOf(html);
  expect(head).not.toBe("");
  expect(head).toContain('<span class="title" title="C:/work/app">app</span>'); // the session name
  expect(head).toContain('<span class="word">Claude</span>'); // who is running
  expect(tokens(head)).toBe("84k/170k"); // the usage, against the auto handoff point
  expect(head).not.toContain("gauge"); // the removed context ring stays gone
  // a plain shell is a pane too: it carries the header
  expect(headerOf(pane({ agent: "shell", cwd: "C:/work/app" }))).toContain("pane-head");
});

test("box 2: in a split tab each pane carries its own header with its own usage", () => {
  publishClaude([{ kind: "five_hour", usedPercent: 20, resetsAt: Date.now() + 3_600_000 }]);
  const left = headerOf(pane({ agent: "claude", cwd: "C:/work/app", usage: readoutOf({ tokens: 17_000, window: 200_000 }, false, false) }));
  const right = headerOf(pane({ agent: "claude", cwd: "C:/work/app", usage: readoutOf({ tokens: 127_500, window: 200_000 }, false, false), title: "tests" }));
  expect(left).not.toBe("");
  expect(right).not.toBe("");
  expect(tokens(left)).toBe("17k/170k");
  expect(tokens(right)).toBe("128k/170k");
  expect(left).not.toBe(right);
});
