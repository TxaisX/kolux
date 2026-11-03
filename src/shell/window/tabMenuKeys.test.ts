// UX lane A (keyboard.md row 3, shell.md rows 7 and 8): the tab menu takes focus, answers the arrows and Escape,
// and gives focus back. No DOM in this test run, so the menu, window and document are small fakes.
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { focusIsLost, openTabMenu } from "./tabMenuKeys";
import dialogs from "./Dialogs.tsx?raw";
import store from "../windowStore.ts?raw";

type Handler = (e: Event) => void;
function setup(opts: { rect?: { top: number; left: number; width: number; height: number }; view?: [number, number]; active?: unknown } = {}) {
  const row = (name: string) => ({ name, isConnected: true, focus: vi.fn(() => void (doc.activeElement = row_[name])) });
  const row_: Record<string, ReturnType<typeof row>> = {};
  for (const n of ["rename", "pin", "close"]) row_[n] = row(n);
  const list = [row_.rename, row_.pin, row_.close];
  const tab = { isConnected: true, focus: vi.fn() };
  const doc = { activeElement: (opts.active === undefined ? tab : opts.active) as unknown, body: { body: true }, querySelector: vi.fn(() => null) };
  const box = {
    style: { top: "", left: "" },
    getBoundingClientRect: () => opts.rect ?? { top: 100, left: 100, width: 240, height: 300 },
    querySelectorAll: vi.fn(() => list),
  };
  const handlers: Record<string, Handler> = {};
  const win = {
    innerWidth: opts.view?.[0] ?? 1200,
    innerHeight: opts.view?.[1] ?? 800,
    addEventListener: vi.fn((t: string, h: Handler) => void (handlers[t] = h)),
    removeEventListener: vi.fn(),
  };
  const key = (k: string) => {
    const e = { key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handlers.keydown(e as unknown as Event);
    return e;
  };
  return { box, win, doc, tab, list: row_, key };
}

test("opening focuses the first row and fits the menu inside a small window", () => {
  const s = setup({ rect: { top: 600, left: 1100, width: 240, height: 300 }, view: [1200, 800] });
  openTabMenu(s.box as never, s.win as never, s.doc as never, () => {});
  expect(s.list.rename.focus).toHaveBeenCalled();
  expect(s.box.style.top).toBe(`${800 - 300 - 8}px`);
  expect(s.box.style.left).toBe(`${1200 - 240 - 8}px`);
});

test("arrows move between the rows, wrapping, and the key never reaches the pane under the menu", () => {
  const s = setup();
  openTabMenu(s.box as never, s.win as never, s.doc as never, () => {});
  const e = s.key("ArrowDown");
  expect(s.list.pin.focus).toHaveBeenCalled();
  expect(e.preventDefault).toHaveBeenCalled();
  expect(e.stopPropagation).toHaveBeenCalled();
  s.key("End");
  expect(s.doc.activeElement).toBe(s.list.close);
  s.key("ArrowDown");
  expect(s.doc.activeElement).toBe(s.list.rename);
  s.key("ArrowUp");
  expect(s.doc.activeElement).toBe(s.list.close);
  const other = s.key("a");
  expect(other.preventDefault).not.toHaveBeenCalled();
});

test("Escape closes the menu before the focused pane sees it", () => {
  const s = setup();
  const onClose = vi.fn();
  openTabMenu(s.box as never, s.win as never, s.doc as never, onClose);
  const registered = s.win.addEventListener.mock.calls.filter((c) => c[0] === "keydown");
  expect(registered.length).toBeGreaterThanOrEqual(2);
  expect(registered.every((c) => (c as unknown[])[2] && ((c as unknown[])[2] as { capture: boolean }).capture === true)).toBe(true);
  // the Escape handler is the first registered (watchEscape)
  const esc = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
  (registered[0][1] as Handler)(esc as unknown as Event);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(esc.stopPropagation).toHaveBeenCalled();
});

test("closing gives focus back to the tab, and only when focus was lost", async () => {
  const lost = setup();
  const stop = openTabMenu(lost.box as never, lost.win as never, lost.doc as never, () => {});
  lost.doc.activeElement = lost.doc.body; // the menu left with focus in it
  stop();
  await Promise.resolve();
  expect(lost.tab.focus).toHaveBeenCalledTimes(1);
  expect(lost.win.removeEventListener).toHaveBeenCalled();

  const moved = setup();
  const stop2 = openTabMenu(moved.box as never, moved.win as never, moved.doc as never, () => {});
  moved.doc.activeElement = { name: "name field" }; // Change Title put focus in the tab's name field
  stop2();
  await Promise.resolve();
  expect(moved.tab.focus).not.toHaveBeenCalled();
});

test("focusIsLost is true only for nothing or the page body", () => {
  const body = {};
  expect(focusIsLost(null, body)).toBe(true);
  expect(focusIsLost(body, body)).toBe(true);
  expect(focusIsLost({}, body)).toBe(false);
});

test("Dialogs wires the hook to the menu element; the old bubble-phase Escape listener is gone", () => {
  expect(dialogs).toContain("useTabMenuKeys(tabMenu !== null, tabBox");
  expect(dialogs).toContain("ref={tabBox}");
  expect(dialogs).toContain("title={why}");
  expect(dialogs).toContain("closeConfirmLabel(asking.keys.length)");
  expect(store).not.toMatch(/Escape" && setTabMenu/);
});
