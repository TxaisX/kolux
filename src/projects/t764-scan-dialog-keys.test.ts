// T-764 / T-738 (#179): the Scan-folder dialog's keyboard on the real ScanRepos. (b) Tab and Shift+Tab wrap inside the
// dialog, (c) Escape closes it with focus on a button (not just on the folder field).
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { FakeNode, find, installDom, mount } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject("not stubbed") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const realFocus = FakeNode.prototype.focus;
afterEach(() => {
  FakeNode.prototype.focus = realFocus;
});

async function open() {
  const { doc, win } = installDom();
  const keys: Array<(e: unknown) => void> = [];
  Object.assign(doc, { querySelector: () => null });
  Object.assign(win, {
    setTimeout,
    clearTimeout,
    addEventListener: (t: string, fn: (e: unknown) => void) => t === "keydown" && keys.push(fn),
    removeEventListener: (t: string, fn: (e: unknown) => void) => t === "keydown" && keys.includes(fn) && keys.splice(keys.indexOf(fn), 1),
  });
  FakeNode.prototype.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  // what a browser lets Tab land on: enabled buttons and inputs, in page order
  (FakeNode.prototype as unknown as Record<string, unknown>).querySelectorAll = function (this: FakeNode) {
    return find(this, (n) => (n.localName === "button" || n.localName === "input") && n.attrs.disabled === undefined && n.disabled !== true);
  };
  const closed = vi.fn();
  const { default: ScanRepos } = await import("./ScanRepos");
  const m = await mount(createElement(ScanRepos, { root: "C:/code", onClose: closed, onDone: () => {}, onProblem: () => {} }), doc);
  const box = find(m.container, (n) => n.attrs.role === "dialog")[0];
  const focusables = () => find(box, (n) => (n.localName === "button" || n.localName === "input") && n.attrs.disabled === undefined && n.disabled !== true);
  const press = (key: string, shiftKey = false) => {
    const e = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of [...keys]) fn(e);
    return e;
  };
  return { doc, focusables, press, closed, unmount: m.unmount };
}

test("T-738: Tab from the last control wraps to the first and Shift+Tab from the first wraps to the last, never leaving the dialog", async () => {
  const d = await open();
  const all = d.focusables();
  expect(all.length).toBeGreaterThan(2);
  const first = all[0];
  const last = all[all.length - 1];
  d.doc.activeElement = last;
  const fwd = d.press("Tab");
  expect(fwd.defaultPrevented).toBe(true);
  expect(d.doc.activeElement, "Tab from the last wraps to the first").toBe(first);
  const back = d.press("Tab", true);
  expect(back.defaultPrevented).toBe(true);
  expect(d.doc.activeElement, "Shift+Tab from the first wraps to the last").toBe(last);
  await d.unmount();
});

test("T-738: Escape closes the Scan dialog while focus is on a button inside it", async () => {
  const d = await open();
  const cancel = find(d.focusables()[0].parentNode!.parentNode!, (n) => n.localName === "button" && n.textContent.trim() === "Cancel")[0];
  expect(cancel, "found the Cancel button").toBeTruthy();
  d.doc.activeElement = cancel;
  d.press("Escape");
  expect(d.closed).toHaveBeenCalledTimes(1);
  await d.unmount();
});
