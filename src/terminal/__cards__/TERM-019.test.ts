// TERM-019 acceptance: every pane draws its own header with who is running, the session name and the usage percentage.
// Renders the real TerminalPane (server render: the header is drawn before any effect runs).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import TerminalPane from "../TerminalPane";
import { contextFill } from "../../usage/meter";

const pane = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(TerminalPane as never, { onClose: () => {}, ...props }));
const headerOf = (html: string) => html.match(/<header class="pane-head"[\s\S]*?<\/header>/)?.[0] ?? "";
const percent = (header: string) => header.match(/class="gauge[^"]*"[^>]*>[\s\S]*?<\/svg>(\d+)%</)?.[1];

test("box 1: a single-pane grid still shows the header, with the program, the session name and the usage", () => {
  const html = pane({ agent: "claude", cwd: "C:/work/app", context: 42, expand: { on: false, can: false, toggle: () => {} } }); // a lone pane: nothing to split from or expand into
  const head = headerOf(html);
  expect(head).not.toBe("");
  expect(head).toContain('<span class="title" title="C:/work/app">app</span>'); // the session name
  expect(head).toContain('<span class="word">Claude</span>'); // who is running
  expect(percent(head)).toBe("42"); // the usage percentage
  // a plain shell is a pane too: it carries the header (its meter reads "agents only")
  expect(headerOf(pane({ agent: "shell", cwd: "C:/work/app" }))).toContain("pane-head");
});

test("box 2: in a split tab each pane carries its own header with its own usage percentage", () => {
  // MIRROR App.tsx:3203: context={context[p.key] ? contextFill(context[p.key], capped) : null}; the readings are per pane key
  const readings: Record<number, { tokens: number; window: number } | undefined> = { 1: { tokens: 17_000, window: 200_000 }, 2: { tokens: 127_500, window: 200_000 } };
  const fill = (key: number) => {
    const r = readings[key];
    return r ? contextFill(r, true) : null;
  };
  const left = headerOf(pane({ agent: "claude", cwd: "C:/work/app", context: fill(1) }));
  const right = headerOf(pane({ agent: "codex", cwd: "C:/work/app", context: fill(2), title: "tests" }));
  expect(left).not.toBe("");
  expect(right).not.toBe("");
  expect(percent(left)).toBe("10");
  expect(percent(right)).toBe("75");
  expect(left).not.toBe(right);
});
