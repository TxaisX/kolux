import { expect, test, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import StatusBar from "./StatusBar";
import { readStatusBar, STATUS_ITEMS, toggleItem } from "./statusItems";
import { FakeNode, find, fire, installDom, mount, until } from "../tasks/fakeDom";

test("VIEW-096: everything shows until something is hidden", () => {
  expect(readStatusBar({})).toEqual({ visible: true, hidden: [] });
  expect(readStatusBar({ statusBarVisible: false }).visible).toBe(false);
  expect(STATUS_ITEMS.map((i) => i.id)).toEqual(["hooks", "memory", "terminals", "agents", "awake", "ports", "pill-claude", "pill-codex"]);
});

test("VIEW-096: an old saved list keeps the items it knows and drops retired or unknown ones", () => {
  expect(readStatusBar({ statusBarHidden: ["memory", "usage-claude", 7, "memory", "agents"] }).hidden).toEqual(["memory", "agents"]);
  expect(readStatusBar({ statusBarHidden: "memory" }).hidden, "not a list: nothing hidden").toEqual([]);
});

test("VIEW-096: unticking an item hides it, ticking it again brings it back", () => {
  const off = toggleItem([], "memory");
  expect(off).toEqual(["memory"]);
  expect(toggleItem(off, "memory")).toEqual([]);
});

test("VIEW-096: a hidden item is not drawn, the others are", () => {
  const html = renderToString(createElement(StatusBar, { terminals: 3, agents: 1, hidden: ["memory"] }));
  expect(html).not.toContain("res-open");
  expect(html).toContain("Terminals running");
  const all = renderToString(createElement(StatusBar, { terminals: 3 }));
  expect(all).toContain("res-open");
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

test("T-710: Shift+F10 / the Menu key on a focused status-bar item opens the items menu where the engine puts it", async () => {
  const { doc, win } = installDom();
  Object.assign(win, { setInterval, clearInterval, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800 });
  // The menu keys look up its rows.
  (FakeNode.prototype as unknown as Record<string, unknown>).querySelectorAll = function (this: FakeNode) {
    return find(this, (n) => (n.attrs.role ?? "").startsWith("menuitem"));
  };
  const { container } = await mount(createElement(StatusBar, { terminals: 3 }), doc);
  const item = find(container, (n) => n.attrs.class === "item res-open")[0];
  // The engine raises contextmenu on the focused element, with button -1 and the element's centre.
  await fire(container, "contextmenu", item, { button: -1, clientX: 1100, clientY: 790 });
  await until(() => find(container, (n) => n.attrs.role === "menu").length === 1, "the items menu");
  const menu = find(container, (n) => n.attrs.role === "menu")[0];
  expect(menu.attrs["aria-label"]).toBe("Status bar items");
  expect([menu.style.left, menu.style.bottom]).toEqual(["960px", "14px"]);
});
