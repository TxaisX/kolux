// T-764 / T-720 (#185): the pane menu's keyboard, driven on the real PaneMenu through the same stand-in DOM the focus test uses.
// (b) ArrowDown/ArrowUp/Home/End move between rows, (c) Tab closes the menu with focus back in the pane, (a) Escape does too.
import { createElement, useState } from "react";
import { expect, test, vi } from "vitest";
import { FakeNode, find, installDom, mount, settle } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

async function openMenu() {
  const { doc, win } = installDom();
  const keys: Array<(e: unknown) => void> = [];
  Object.assign(win, {
    addEventListener: (t: string, fn: (e: unknown) => void) => t === "keydown" && keys.push(fn),
    removeEventListener: (t: string, fn: (e: unknown) => void) => t === "keydown" && keys.includes(fn) && keys.splice(keys.indexOf(fn), 1),
    innerWidth: 1200,
    innerHeight: 800,
  });
  const proto = FakeNode.prototype as unknown as Record<string, unknown>;
  proto.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120 });
  const rowsOf = (n: FakeNode) => find(n, (c) => c.attrs.role === "menuitem");
  proto.querySelectorAll = function (this: FakeNode) {
    return rowsOf(this);
  };
  proto.querySelector = function (this: FakeNode) {
    return rowsOf(this)[0] ?? null;
  };
  const { default: PaneMenu, paneMenuItems } = await import("./PaneMenu");
  const items = paneMenuItems({ selected: false, expanded: false, canExpand: false, onCopy() {}, onSelectAll() {}, onPaste() {}, agentActions: [], copyIds: [], hasTitle: false, onClear() {}, onFind() {} });
  const terminal = doc.createElement("textarea");
  Object.assign(terminal, { isConnected: true });
  doc.body.appendChild(terminal);
  terminal.focus();
  function Host() {
    const [open, setOpen] = useState(true);
    return open ? createElement(PaneMenu, { style: {}, items, onDismiss: () => setOpen(false) }) : null;
  }
  const { container } = await mount(createElement(Host), doc);
  await settle();
  const press = async (key: string) => {
    const e = { key, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of [...keys]) fn(e);
    await settle();
    return e;
  };
  return { doc, container, rows: () => rowsOf(container), terminal, press };
}

test("T-720: in the pane menu ArrowDown goes to row 2, End to the last row, Home to the first, ArrowUp wraps to the last", async () => {
  const m = await openMenu();
  const rows = m.rows();
  expect(rows.length).toBeGreaterThan(3);
  expect(m.doc.activeElement, "opens on the first row").toBe(rows[0]);
  await m.press("ArrowDown");
  expect(m.doc.activeElement).toBe(rows[1]);
  await m.press("End");
  expect(m.doc.activeElement).toBe(rows[rows.length - 1]);
  await m.press("Home");
  expect(m.doc.activeElement).toBe(rows[0]);
  await m.press("ArrowUp");
  expect(m.doc.activeElement, "Up from the first wraps to the last").toBe(rows[rows.length - 1]);
});

test("T-720: Tab in the pane menu closes it and focus goes back into the pane, not the page", async () => {
  const m = await openMenu();
  await m.press("ArrowDown");
  const tab = await m.press("Tab");
  expect(tab.defaultPrevented, "the browser does not also step focus on").toBe(true);
  expect(find(m.container, (n) => n.attrs.role === "menu").length, "menu closed").toBe(0);
  expect(m.doc.activeElement, "focus is back on the terminal").toBe(m.terminal);
});

test("T-720: Escape in the pane menu closes it and focus goes back into the pane, not the page", async () => {
  const m = await openMenu();
  const esc = await m.press("Escape");
  expect(esc.defaultPrevented).toBe(true);
  expect(find(m.container, (n) => n.attrs.role === "menu").length, "menu closed").toBe(0);
  expect(m.doc.activeElement, "focus is back on the terminal").toBe(m.terminal);
});
