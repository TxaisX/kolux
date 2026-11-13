// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import StatusBar from "./StatusBar";
import { readStatusBar, STATUS_ITEMS, toggleItem } from "./statusItems";
import { byText, find, fire, installDom, mount, until } from "../tasks/realDom";

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
  installDom();
  const toggled: string[] = [];
  const { container, unmount } = await mount(createElement(StatusBar, { terminals: 3, onToggle: (id: string) => toggled.push(id) }));
  const item = find(container, (n) => n.getAttribute("class") === "item res-open")[0];
  // The engine raises contextmenu on the focused element, with button -1 and the element's centre.
  await fire(container, "contextmenu", item, { button: -1, clientX: 1000, clientY: 700 });
  await until(() => find(container, (n) => n.getAttribute("role") === "menu").length === 1, "the items menu");
  const menu = find(container, (n) => n.getAttribute("role") === "menu")[0];
  expect(menu.getAttribute("aria-label")).toBe("Status bar items");
  expect(menu.classList.contains("status-menu")).toBe(true);
  // It opens upward where it always did: its bottom edge 4 px above the point, its left edge at the point but never
  // nearer than 240 px to the window's right edge (this test window is 1024 x 768).
  const at = menu.parentElement.style;
  expect([window.innerWidth, window.innerHeight]).toEqual([1024, 768]);
  expect([at.left, at.bottom, at.transform]).toEqual(["784px", "72px", "none"]);
  // An item is a ticked checkbox row, and ticking one keeps the menu open for the next.
  const memory = byText(menu, "span", "Resource Manager")[0].closest('[role="menuitemcheckbox"]');
  expect(memory.getAttribute("aria-checked")).toBe("true");
  await fire(container, "click", memory);
  expect(toggled).toEqual(["memory"]);
  expect(find(container, (n) => n.getAttribute("role") === "menu")).toHaveLength(1);
  await unmount();
});
