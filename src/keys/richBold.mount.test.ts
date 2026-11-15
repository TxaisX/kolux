// Audit F22 on the real window key handler (useWindowKeys on the small DOM): inside the rich Markdown view
// (`.md-rich`) Ctrl+B is the editor's bold key, so the handler lets the press through untouched (no
// preventDefault, no sidebar change). Outside the view Ctrl+B toggles the sidebar as before, and Toggle Sidebar
// moved to another key still works inside the view: the press is exempt, not the action.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, installDom, mount } from "../tasks/fakeDom";
import { resolve } from "./keymap";

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));

let doc: FakeDocument;
let onKey: ((e: unknown) => void) | null = null; // the first capture listener: the key handler (a later one only watches modifiers)
let unmount: () => Promise<void> = async () => {};
let toggles = 0;

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, {
    setInterval, clearInterval, setTimeout, clearTimeout,
    addEventListener: (type: string, fn: (e: unknown) => void, capture?: boolean) => {
      if (type === "keydown" && capture) onKey ??= fn;
    },
  });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, activeElement: null });
  onKey = null;
  toggles = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const inside = (sel: string | null) => ({ closest: (s: string) => (sel && s === sel ? {} : null) });

async function handler(kind: "editor" | "terminal", keymap = resolve(null, "win32")) {
  const { useWindowKeys } = await import("./useWindowKeys");
  const pane = { key: "p1", kind, cwd: "C:/w/app" };
  const bag = {
    keymap, screen: "terminals", panes: [pane], focused: "p1", activeDir: "C:/w/app", settings: {}, switcherRef: { current: false },
    setSidebarOpen: (f: (o: boolean) => boolean) => void (f(true), toggles++), setToast: () => {},
  };
  const Host = () => (useWindowKeys(bag as never), null);
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  expect(onKey, "the handler listens on the window").not.toBeNull();
}

function press(key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) {
  const e = {
    type: "keydown", key, code: `Key${key.toUpperCase()}`, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods,
    isComposing: false, keyCode: key.toUpperCase().charCodeAt(0), repeat: false, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  onKey!(e);
  return e;
}

test("Ctrl+B with the focus in the rich Markdown view reaches the editor: sidebar unchanged, event not prevented", async () => {
  await handler("editor");
  Object.assign(doc, { activeElement: inside(".md-rich") });
  const e = press("b", { ctrlKey: true });
  expect(toggles).toBe(0);
  expect(e.defaultPrevented).toBe(false);
  expect(e.stopped).toBe(false);
});

test("Ctrl+B with the focus in a terminal, or nowhere, toggles the sidebar as before", async () => {
  await handler("terminal");
  Object.assign(doc, { activeElement: inside(".xterm") });
  const t = press("b", { ctrlKey: true });
  expect(toggles).toBe(1);
  expect(t.defaultPrevented).toBe(true);
  Object.assign(doc, { activeElement: null });
  const n = press("b", { ctrlKey: true });
  expect(toggles).toBe(2);
  expect(n.defaultPrevented).toBe(true);
});

test("Ctrl+B in a code editor tab (not the rich view) still toggles the sidebar", async () => {
  await handler("editor");
  Object.assign(doc, { activeElement: inside(".cm-editor") });
  press("b", { ctrlKey: true });
  expect(toggles).toBe(1);
});

test("Toggle Sidebar moved to Ctrl+Alt+S still works inside the rich view; Ctrl+B there stays the editor's", async () => {
  const keymap = resolve({ "sidebar.left.toggle": ["Mod+Alt+S"] } as never, "win32");
  await handler("editor", keymap);
  Object.assign(doc, { activeElement: inside(".md-rich") });
  const moved = press("s", { ctrlKey: true, altKey: true });
  expect(toggles).toBe(1);
  expect(moved.defaultPrevented).toBe(true);
  press("b", { ctrlKey: true });
  expect(toggles).toBe(1);
});
