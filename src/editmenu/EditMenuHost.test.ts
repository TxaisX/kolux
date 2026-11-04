// T-710 (DT-C146): the text field's edit menu takes focus on its first row, Up/Down move between the rows, and
// Escape closes it and gives focus back to the field. Mounted in the fake DOM; the engine's suggestions are off.
import { createElement } from "react";
import { expect, test, vi } from "vitest";
import { FakeNode, find, fire, installDom, mount, settle, until } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

test("T-737: right-click Paste says so when the clipboard is refused", async () => {
  vi.stubGlobal("navigator", { clipboard: { readText: () => Promise.reject(new Error("denied")) } });
  const { runEdit } = await import("./EditMenuHost");
  const said: string[] = [];
  runEdit({ focus: () => {} } as unknown as HTMLElement, { kind: "paste" }, (m) => said.push(m));
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
  expect(said).toEqual(["The clipboard could not be read; paste with the keyboard instead"]);
});

test("T-710: the edit menu opens with focus on its first row, the arrows move it, Escape closes and refocuses the field", async () => {
  const { doc, win } = installDom();
  // The menu keys listen on the window in the capture phase.
  const keys: Array<(e: unknown) => void> = [];
  Object.assign(win, {
    setTimeout,
    clearTimeout,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (t: string, fn: (e: unknown) => void) => t === "keydown" && keys.push(fn),
    removeEventListener: (t: string, fn: (e: unknown) => void) => t === "keydown" && keys.includes(fn) && keys.splice(keys.indexOf(fn), 1),
  });
  const g = globalThis as unknown as Record<string, unknown>;
  g.HTMLElement = FakeNode;
  const proto = FakeNode.prototype as unknown as Record<string, unknown>;
  proto.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  proto.closest = () => null;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120 });
  proto.querySelectorAll = function (this: FakeNode) {
    return find(this, (n) => (n.attrs.role ?? "").startsWith("menuitem") && !n.disabled);
  };
  const { default: EditMenuHost } = await import("./EditMenuHost");
  const { container } = await mount(createElement(EditMenuHost), doc);
  await settle();
  const field = doc.createElement("input");
  Object.assign(field, { isConnected: true, selectionStart: 0, selectionEnd: 2 });
  container.appendChild(field);
  field.focus();
  await fire(doc, "contextmenu", field, { button: -1, clientX: 40, clientY: 30 });
  await until(() => find(container, (n) => n.attrs.role === "menu").length === 1, "the edit menu");
  const rows = find(container, (n) => n.attrs.role === "menuitem" && !n.disabled);
  expect(rows.length).toBeGreaterThan(1);
  expect(doc.activeElement, "focus on the first row").toBe(rows[0]);
  const press = async (key: string) => {
    for (const fn of [...keys]) fn({ key, shiftKey: false, preventDefault() {}, stopPropagation() {} });
    await settle();
  };
  await press("ArrowDown");
  expect(doc.activeElement, "Down: the next row").toBe(rows[1]);
  await press("ArrowUp");
  expect(doc.activeElement, "Up: back to the first").toBe(rows[0]);
  await press("Escape");
  expect(find(container, (n) => n.attrs.role === "menu").length, "Escape closes").toBe(0);
  expect(doc.activeElement, "focus back on the field").toBe(field);
});
