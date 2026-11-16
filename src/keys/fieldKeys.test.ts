// Audit F28 on the real window key handler (useWindowKeys on the small DOM): while a plain text field has the
// focus (a settings box, the palette, a commit message), a key that closes, ends or deletes something does not
// run, so Ctrl+W typed in a field never closes the pane behind it. Every other global key still works there, and
// the terminal, the code editor and the rich Markdown view keep the rules they had.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, installDom, mount } from "../tasks/fakeDom";
import { resolve } from "./keymap";
import { CLOSING_KEYS } from "./useWindowKeys";

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));

let doc: FakeDocument;
let onKey: ((e: unknown) => void) | null = null; // the first capture listener: the key handler
let unmount: () => Promise<void> = async () => {};
let closed: unknown[] = [];
let newTabs = 0;

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, {
    setInterval, clearInterval, setTimeout, clearTimeout,
    addEventListener: (type: string, fn: (e: unknown) => void, capture?: boolean) => {
      if (type === "keydown" && capture) onKey ??= fn;
    },
    dispatchEvent: () => true, // no pane claims its own close
  });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, activeElement: null });
  onKey = null;
  closed = [];
  newTabs = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

/** A focused element: its tag, its input type, and the one ancestor selector it sits inside (or none). */
const el = (tag: string, type = "", inside: string | null = null) => ({
  tagName: tag.toUpperCase(), type, isContentEditable: false, getAttribute: () => null,
  closest: (s: string) => (inside && s.split(",").map((x) => x.trim()).includes(inside) ? {} : null),
});

async function handler() {
  const { useWindowKeys } = await import("./useWindowKeys");
  const pane = { key: "p1", kind: "terminal", cwd: "C:/w/app" };
  const bag = {
    keymap: resolve(null, "win32"), screen: "terminals", panes: [pane], focused: "p1", activeDir: "C:/w/app", settings: {}, switcherRef: { current: false },
    closePane: (k: unknown) => void closed.push(k), newTab: () => void newTabs++, setToast: () => {},
  };
  const Host = () => (useWindowKeys(bag as never), null);
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  expect(onKey, "the handler listens on the window").not.toBeNull();
}

function press(key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  const e = {
    type: "keydown", key, code: `Key${key.toUpperCase()}`, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods,
    isComposing: false, keyCode: key.toUpperCase().charCodeAt(0), repeat: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
  };
  onKey!(e);
  return e;
}

test("Ctrl+W with the focus in a text box does not close the pane, and the webview's own action for it does not run either (R54-04)", async () => {
  await handler();
  Object.assign(doc, { activeElement: el("input", "text") });
  const e = press("w", { ctrlKey: true });
  expect(closed).toEqual([]);
  expect(e.defaultPrevented).toBe(true);
  Object.assign(doc, { activeElement: el("textarea") });
  press("w", { ctrlKey: true });
  expect(closed).toEqual([]);
});

test("Ctrl+W with the focus in a terminal closes the pane as before", async () => {
  await handler();
  Object.assign(doc, { activeElement: el("textarea", "", ".xterm") });
  press("w", { ctrlKey: true });
  expect(closed).toEqual(["p1"]);
});

test("a key that closes nothing (Ctrl+T, new terminal tab) still works while typing in a text box", async () => {
  await handler();
  Object.assign(doc, { activeElement: el("input", "text") });
  press("t", { ctrlKey: true });
  expect(newTabs).toBe(1);
});

test("Ctrl+W with the focus on a button or a checkbox closes the pane as before", async () => {
  await handler();
  Object.assign(doc, { activeElement: el("button") });
  press("w", { ctrlKey: true });
  Object.assign(doc, { activeElement: el("input", "checkbox") });
  press("w", { ctrlKey: true });
  expect(closed).toEqual(["p1", "p1"]);
});

test("the keys held while typing are the ones that close, end or delete something", () => {
  expect([...CLOSING_KEYS].sort()).toEqual(["sessions.remove", "tab.close", "tab.closeAll", "terminal.closePane", "workspace.delete"]);
});

test("R54-01: Close tab picked from the palette, opened from a text box, closes the pane; a typed Ctrl+W there still does not", async () => {
  const { runCommand } = await import("./runCommand");
  await handler();
  const input = el("input", "text");
  Object.assign(doc, { activeElement: input });
  // The palette's stand-in: a keydown sent to the element that has the keyboard, which reaches the window's handler.
  const target = { dispatchEvent: (ev: unknown) => (onKey!(ev), true) } as unknown as EventTarget;
  const event = () => ({ type: "keydown", key: "Unidentified", isComposing: false, keyCode: 0, preventDefault() {}, stopPropagation() {} }) as unknown as Event;
  runCommand("tab.close", undefined, { later: (f) => f(), target, event });
  expect(closed).toEqual(["p1"]);
  press("w", { ctrlKey: true });
  expect(closed).toEqual(["p1"]);
});

test("R54-05: Ctrl+W typed in a terminal's own Find box closes that pane, as in the code editor's search box", async () => {
  await handler();
  Object.assign(doc, { activeElement: el("input", "text", ".term-find") });
  press("w", { ctrlKey: true });
  expect(closed).toEqual(["p1"]);
  const bar = (await import("../terminal/FindBar.tsx?raw")).default;
  expect(bar, "the Find bar carries the class the guard looks for").toContain('className="term-find"');
});

test("R54-04: Ctrl+Shift+Backspace held by a text box stays the field's own key (a Backspace chord edits text)", async () => {
  await handler();
  Object.assign(doc, { activeElement: el("input", "text") });
  const e = press("Backspace", { ctrlKey: true, shiftKey: true });
  expect(e.defaultPrevented).toBe(false);
});
