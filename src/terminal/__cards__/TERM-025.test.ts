// TERM-025 acceptance: the pane header's buttons (more, expand, split, close) and the right-click menu. Renders the real
// TerminalPane; a recording wrapper of the JSX runtime keeps the header and button props so their handlers can be called,
// and one of useState keeps every setter's calls (the menu position is state, set by openMenu).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

type Props = Record<string, unknown>;
const seen: { type: unknown; props: Props }[] = [];
const setters: { id: number; calls: unknown[] }[] = [];
let sid = 0;
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const real = await orig<typeof import("react/jsx-dev-runtime")>();
  return {
    ...real,
    jsxDEV: (type: unknown, props: Props, ...rest: unknown[]) => {
      if (type === "header" || type === "button") seen.push({ type, props });
      return (real.jsxDEV as (...a: unknown[]) => unknown)(type, props, ...rest);
    },
  };
});
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    useState: (init: unknown) => {
      const [v, set] = (real.useState as (i: unknown) => [unknown, (x: unknown) => void])(init);
      const rec = { id: sid++, calls: [] as unknown[] };
      setters.push(rec);
      return [v, (x: unknown) => (rec.calls.push(x), set(x))];
    },
  };
});
const { default: TerminalPane } = await import("../TerminalPane");

const render = (props: Props) => {
  seen.length = 0;
  setters.length = 0;
  sid = 0;
  return renderToStaticMarkup(createElement(TerminalPane as never, { agent: "claude", cwd: "C:/work/app", onClose: () => {}, onSplit: () => {}, expand: { on: false, can: true, toggle: () => {} }, ...props }));
};
const titlesOf = (html: string) => [...html.matchAll(/<button class="ib(?: [^"]*)?"[^>]*?title="([^"]*)"/g)].map((m) => m[1]);
const kind = (t: string) => (t.startsWith("Pane menu") ? "more" : t.startsWith("Expand") || t.startsWith("Restore") ? "expand" : t.startsWith("Split") ? "split" : t.startsWith("Close") ? "close" : "other");

beforeEach(() => {
  seen.length = 0;
});

test("box 1: the four buttons appear in the same order on every pane: more, expand, split, close", () => {
  const order = (html: string) => titlesOf(html).map(kind).filter((k) => k !== "other");
  const want = ["more", "expand", "split", "close"];
  expect(order(render({}))).toEqual(want); // a pane in a split grid
  expect(order(render({ expand: { on: true, can: true, toggle: () => {} } }))).toEqual(want); // the expanded pane (Restore)
  expect(order(render({ expand: { on: false, can: false, toggle: () => {} } }))).toEqual(want); // a lone classic pane: expand is disabled, not removed
  expect(order(render({ agent: "shell" }))).toEqual(want); // a plain shell
  expect(order(render({ agent: "codex", usage: undefined, context: 80 }))).toEqual(want);
  // the other control between split and close is the new-session plus; the four named buttons keep their order around it
  expect(titlesOf(render({})).map(kind)).toEqual(["more", "expand", "split", "other", "close"]);
});

test("box 2: right-clicking the header opens the same menu as the more button (same opener, same menu state)", () => {
  render({});
  const header = seen.find((s) => s.type === "header" && s.props.className === "pane-head")!;
  const more = seen.find((s) => s.type === "button" && s.props.title === "Pane menu")!;
  expect(header && more).toBeTruthy();
  const before = setters.map((s) => s.calls.length);
  let prevented = 0;
  (header.props.onContextMenu as (e: unknown) => void)({ target: { closest: () => null }, preventDefault: () => prevented++, clientX: 30, clientY: 40 });
  const afterRight = setters.map((s) => s.calls.length);
  const rightSet = setters.filter((_, i) => afterRight[i] > before[i]);
  expect(prevented).toBe(1);
  expect(rightSet).toHaveLength(1);
  (more.props.onClick as (e: unknown) => void)({ currentTarget: { getBoundingClientRect: () => ({ left: 30, bottom: 36 }) } });
  const afterMore = setters.map((s) => s.calls.length);
  const moreSet = setters.filter((_, i) => afterMore[i] > afterRight[i]);
  expect(moreSet).toHaveLength(1);
  // both press the one menu-position state; the menu shown is whatever that state holds (one PaneMenu in the pane)
  expect(moreSet[0].id).toBe(rightSet[0].id);
  expect(rightSet[0].calls[0]).toEqual({ top: 40, left: 30, selected: false });
  expect(moreSet[0].calls[1]).toEqual({ top: 40, left: 30, selected: false });
});
