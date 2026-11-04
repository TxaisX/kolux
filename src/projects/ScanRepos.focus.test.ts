// T-738: the Scan-folder dialog takes the keyboard when it opens (its folder field) and gives it back to
// the control that opened it when it closes, through the shared dialog hook (chrome/dialogFocus.ts).
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

test("T-738: opening Scan a folder puts focus on its folder field; closing it gives focus back to the opener", async () => {
  const { doc, win } = installDom();
  Object.assign(doc, { querySelector: () => null, querySelectorAll: () => [] });
  Object.assign(win, { setTimeout, clearTimeout });
  FakeNode.prototype.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  const opener = doc.createElement("button");
  doc.body.appendChild(opener);
  Object.assign(opener, { isConnected: true }); // the fake DOM has no isConnected; the browser's opener is still on the page
  opener.focus();
  const { default: ScanRepos } = await import("./ScanRepos");
  const m = await mount(createElement(ScanRepos, { root: "C:/code", onClose: () => {}, onDone: () => {}, onProblem: () => {} }), doc);
  const field = find(m.container, (n) => n.attrs["aria-label"] === "folder to scan")[0];
  expect(doc.activeElement, "focus moved into the dialog, on the folder field").toBe(field);
  await m.unmount();
  expect(doc.activeElement, "focus went back to the opener").toBe(opener);
});
