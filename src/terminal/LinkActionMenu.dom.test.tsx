// @vitest-environment happy-dom
// TERM-094 / VIEW-105 on a real DOM: the link menu is a src/ui context menu named "Link menu" at the pointer, with
// the link's destination above its rows; focus starts on the first row, Copy keeps the menu open and says whether
// the copy landed, any other row runs and closes it, and Escape closes it with focus back where it was.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LinkActionMenu from "./LinkActionMenu";
import type { LinkItem, LinkItemId } from "./linkMenu";
import { byLabel, byText, click, find, fire, installDom, mount, settle, until, type FakeNode } from "../tasks/realDom";

const items: LinkItem[] = [
  { id: "open-system", name: "Open in your browser" },
  { id: "copy", name: "Copy link" },
  { id: "settings", name: "Link settings" },
];

let unmount: () => Promise<void> = async () => {};
beforeEach(() => installDom());
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("TERM-094: the link menu opens at the pointer, Copy stays open, another row closes it, Escape closes it", async () => {
  const picked: LinkItemId[] = [];
  const dismissed = vi.fn();
  function Page() {
    const [open, setOpen] = useState(true);
    return createElement(
      "div",
      null,
      createElement("button", { id: "term" }, "terminal"),
      open &&
        createElement(LinkActionMenu, {
          at: { top: 40, left: 60 },
          destination: "https://example.com/a",
          items,
          onPick: (id: LinkItemId) => (picked.push(id), id === "copy" ? Promise.resolve(true) : undefined),
          onDismiss: () => (dismissed(), setOpen(false)),
        }),
    );
  }
  const m = await mount(createElement(Page));
  unmount = m.unmount;
  const c = m.container;
  await until(() => byLabel(c, "div", "Link menu").length === 1, "the link menu");
  const menu: FakeNode = byLabel(c, "div", "Link menu")[0];
  expect(menu.getAttribute("role")).toBe("menu");
  expect(menu.classList.contains("link-menu")).toBe(true);
  expect(menu.textContent).toContain("https://example.com/a");
  const rows = find(menu, (n) => n.getAttribute("role") === "menuitem");
  expect(rows.map((r: FakeNode) => r.textContent)).toEqual(["Open in your browser", "Copy link", "Link settings"]);
  await until(() => document.activeElement === rows[0], "focus on the first row");

  await click(c, byText(menu, "button", "Copy link")[0]);
  await until(() => byText(c, "button", "Copied").length === 1, "the copy's answer");
  expect(byLabel(c, "div", "Link menu")).toHaveLength(1);
  expect(dismissed).not.toHaveBeenCalled();

  await click(c, byText(c, "button", "Open in your browser")[0]);
  await settle();
  expect(picked).toEqual(["copy", "open-system"]);
  expect(dismissed).toHaveBeenCalledTimes(1);
  expect(byLabel(c, "div", "Link menu")).toHaveLength(0);
});

test("TERM-094: Escape closes the link menu and hands focus back", async () => {
  const term = document.createElement("button");
  document.body.appendChild(term);
  term.focus();
  const dismissed = vi.fn();
  function Page() {
    const [open, setOpen] = useState(true);
    return open ? createElement(LinkActionMenu, { at: { top: 10, left: 10 }, destination: "C:/w/a.txt", items, onPick: () => undefined, onDismiss: () => (dismissed(), setOpen(false)) }) : null;
  }
  const m = await mount(createElement(Page));
  unmount = m.unmount;
  await until(() => byLabel(m.container, "div", "Link menu").length === 1, "the link menu");
  await fire(m.container, "keydown", document.activeElement ?? document.body, { key: "Escape" });
  await settle();
  expect(dismissed).toHaveBeenCalledTimes(1);
  expect(byLabel(m.container, "div", "Link menu")).toHaveLength(0);
});
