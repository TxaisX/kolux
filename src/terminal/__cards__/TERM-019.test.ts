// TERM-019 acceptance: every pane draws its own header with who is running and the session name.
// Renders the real TerminalPane (server render: the header is drawn before any effect runs).
// 2026-11-12: the context ring and percentage (USAGE-001) were removed from the header.
// 2026-11-21 (Txais): the token, plan and cost figures left the app's screens; they live in
// Settings > Usage, so the header carries no usage readout any more.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import TerminalPane from "../TerminalPane";

const pane = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(TerminalPane as never, { onClose: () => {}, ...props }));
const headerOf = (html: string) => html.match(/<header class="pane-head"[\s\S]*?<\/header>/)?.[0] ?? "";

test("box 1: a single-pane grid still shows the header, with the program and the session name", () => {
  const html = pane({ agent: "claude", cwd: "C:/work/app", expand: { on: false, can: false, toggle: () => {} } }); // a lone pane: nothing to split from or expand into
  const head = headerOf(html);
  expect(head).not.toBe("");
  expect(head).toContain('<span class="title" title="C:/work/app">app</span>'); // the session name
  expect(head).toContain('<span class="word">Claude</span>'); // who is running
  expect(head).not.toContain("usage-tokens"); // the figures live in Settings > Usage
  expect(head).not.toContain("gauge"); // the removed context ring stays gone
  // a plain shell is a pane too: it carries the header
  expect(headerOf(pane({ agent: "shell", cwd: "C:/work/app" }))).toContain("pane-head");
});

test("box 2: in a split tab each pane carries its own header", () => {
  const left = headerOf(pane({ agent: "claude", cwd: "C:/work/app" }));
  const right = headerOf(pane({ agent: "claude", cwd: "C:/work/app", title: "tests" }));
  expect(left).not.toBe("");
  expect(right).not.toBe("");
  expect(left).toContain(">app<");
  expect(right).toContain(">tests<");
  expect(left).not.toBe(right);
});
