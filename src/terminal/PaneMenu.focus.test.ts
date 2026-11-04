// T-720 (DT-C156): the live trace (live-verify t11) showed focus left on the page after Escape closed the pane
// menu. Under StrictMode's dev double mount the first cleanup could not see the menu any more (its ref was
// detached), so it did not hand focus back, and the second mount then saved the menu's own row as "where focus was".
import { createElement, StrictMode, useState } from "react";
import { expect, test, vi } from "vitest";
import { FakeNode, find, installDom, mount, settle } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

test("T-720: Escape closes the pane menu and focus goes back to the terminal, under StrictMode too", async () => {
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
  const { container } = await mount(createElement(StrictMode, null, createElement(Host)), doc);
  await settle();
  expect(doc.activeElement, "focus on the first row").toBe(rowsOf(container)[0]);
  for (const fn of [...keys]) fn({ key: "Escape", shiftKey: false, preventDefault() {}, stopPropagation() {} });
  await settle();
  expect(find(container, (n) => n.attrs.role === "menu").length, "Escape closes").toBe(0);
  expect(doc.activeElement, "focus back on the terminal, not the page").toBe(terminal);
});
