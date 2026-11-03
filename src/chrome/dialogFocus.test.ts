// UX lane A (chrome.md:11, destructive.md:5, keyboard.md:8, chrome.md:3/4, usage-status.md:5): a dialog traps Tab and
// gives focus back; a menu takes focus, moves with the arrow keys and closes on Escape before the terminal sees it.
// There is no jsdom, so the page is a small stand-in: a window that keeps its listeners, a document with an active
// element, and boxes that answer the two selector queries the helper makes.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FOCUSABLE, MENU_ROWS, menuRoom, tabTarget, trapDialog, trapMenu } from "./dialogFocus";

type Fake = { name: string; isConnected: boolean; focus: () => void };
type Handler = (e: Record<string, unknown>) => void;

let active: Fake | null;
let body: Fake;
let handlers: Handler[];
const el = (name: string): Fake => ({ name, isConnected: true, focus() { active = this; } });
const fakeWindow = {
  addEventListener: (_t: string, h: Handler) => handlers.push(h),
  removeEventListener: (_t: string, h: Handler) => void (handlers = handlers.filter((x) => x !== h)),
};
/** Sends a key to every window listener in order, as the capture phase would, until one stops it. */
const press = (key: string, extra: Record<string, unknown> = {}) => {
  const e = { key, shiftKey: false, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
  for (const h of [...handlers]) {
    if (e.stopped) break;
    h(e);
  }
  return e;
};
const box = (focusables: Fake[], rows: Fake[] = []) => ({
  querySelectorAll: (sel: string) => (sel === FOCUSABLE ? focusables : sel === MENU_ROWS ? rows : []),
  contains: (x: unknown) => focusables.includes(x as Fake) || rows.includes(x as Fake),
}) as unknown as HTMLElement;

beforeEach(() => {
  handlers = [];
  body = el("body");
  active = body;
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", {
    get activeElement() { return active; },
    body,
    querySelector: () => null,
  });
});
afterEach(() => vi.unstubAllGlobals());

test("tabTarget wraps at both ends, pulls a stray focus in and leaves the middle to the browser", () => {
  const items = ["a", "b", "c"];
  expect(tabTarget(items, "c", false)).toEqual({ to: "a", prevent: true });
  expect(tabTarget(items, "a", true)).toEqual({ to: "c", prevent: true });
  expect(tabTarget(items, "b", false)).toEqual({ to: null, prevent: false });
  expect(tabTarget(items, "b", true)).toEqual({ to: null, prevent: false });
  expect(tabTarget(items, "outside", false)).toEqual({ to: "a", prevent: true });
  expect(tabTarget(items, "outside", true)).toEqual({ to: "c", prevent: true });
  expect(tabTarget([], "x", false)).toEqual({ to: null, prevent: true });
});

test("a dialog: focus moves in, Tab and Shift+Tab stay inside, Escape closes from anywhere and focus goes back", () => {
  const opener = el("opener");
  active = opener;
  const cancel = el("cancel");
  const confirm = el("confirm");
  const onClose = vi.fn();
  const stop = trapDialog(box([cancel, confirm]), onClose, () => cancel as unknown as HTMLElement);
  expect(active, "focus moved in").toBe(cancel);

  const fwd = press("Tab");
  expect(fwd.defaultPrevented, "middle: the browser steps on").toBe(false);
  active = confirm;
  const wrap = press("Tab");
  expect(wrap.defaultPrevented).toBe(true);
  expect(active, "Tab from the last control wraps to the first").toBe(cancel);
  const back = press("Tab", { shiftKey: true });
  expect(back.defaultPrevented).toBe(true);
  expect(active, "Shift+Tab from the first wraps to the last").toBe(confirm);
  active = body; // a click on the dialog's text drops focus on the page
  press("Tab");
  expect(active, "Tab from outside lands in the dialog").toBe(cancel);

  active = body; // Escape still works after focus was lost
  const esc = press("Escape");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(esc.stopped, "the terminal underneath never gets the Escape").toBe(true);

  stop();
  expect(active, "focus returns to what had it").toBe(opener);
  expect(handlers, "both listeners removed").toHaveLength(0);
  press("Escape");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a dialog gives focus back only when nobody else took it", () => {
  const opener = el("opener");
  active = opener;
  const cancel = el("cancel");
  const stop = trapDialog(box([cancel]), () => {}, () => cancel as unknown as HTMLElement);
  const other = el("somewhere else");
  active = other; // the confirm opened another surface that took the keyboard
  stop();
  expect(active).toBe(other);
});

test("a menu: focus on the first row, arrows wrap between rows, Escape closes it before the terminal and focus goes back", () => {
  const trigger = el("trigger");
  active = trigger;
  const rows = [el("one"), el("two"), el("three")];
  const onClose = vi.fn();
  const stop = trapMenu(box([], rows), onClose);
  expect(active).toBe(rows[0]);
  const down = press("ArrowDown");
  expect(active).toBe(rows[1]);
  expect(down.defaultPrevented).toBe(true);
  press("ArrowDown");
  press("ArrowDown");
  expect(active, "wraps past the last row").toBe(rows[0]);
  press("ArrowUp");
  expect(active, "wraps back up").toBe(rows[2]);
  press("Home");
  expect(active).toBe(rows[0]);
  press("End");
  expect(active).toBe(rows[2]);
  expect(press("a").defaultPrevented, "other keys are left alone").toBe(false);

  const esc = press("Escape");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(esc.stopped).toBe(true);
  stop();
  expect(active).toBe(trigger);
});

test("a popup in a hidden pane leaves Tab, Escape and the arrows alone", () => {
  let hidden = false;
  const ok = el("ok");
  const b = Object.assign(box([ok], [ok]), { closest: (sel: string) => (sel === "[hidden]" && hidden ? {} : null) });
  const onClose = vi.fn();
  const stopDialog = trapDialog(b, onClose);
  hidden = true;
  const other = el("field");
  active = other;
  expect(press("Tab").defaultPrevented, "Tab is not trapped by a hidden dialog").toBe(false);
  expect(press("Escape").stopped, "Escape goes on to whatever is shown").toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  stopDialog();
  hidden = false;
  const stopMenu = trapMenu(b, onClose);
  hidden = true;
  active = ok;
  expect(press("ArrowDown").defaultPrevented).toBe(false);
  stopMenu();
});

test("a menu leaves the arrows alone once focus is outside it, and Tab closes it", () => {
  const rows = [el("one"), el("two")];
  const onClose = vi.fn();
  const stop = trapMenu(box([], rows), onClose);
  const field = el("field");
  active = field;
  expect(press("ArrowDown").defaultPrevented, "the arrows belong to the field").toBe(false);
  expect(active).toBe(field);
  active = rows[0];
  press("Tab");
  expect(onClose).toHaveBeenCalledTimes(1);
  stop();
});

test("a menu's height cap: the room below its top, or above its bottom when it opens upward", () => {
  expect(menuRoom({ top: 70, bottom: 400 }, 300, false), "downward: 300 - 70 - 8").toBe(222);
  expect(menuRoom({ top: -20, bottom: 290 }, 300, true), "upward: 290 - 8, never past the window's top").toBe(282);
  expect(menuRoom({ top: 290, bottom: 300 }, 300, false), "never below 80").toBe(80);
  const rows = [el("one")];
  const style: Record<string, string> = { bottom: "28px" };
  const b = Object.assign(box([], rows), { style, getBoundingClientRect: () => ({ top: -20, bottom: 290 }) });
  vi.stubGlobal("window", { ...fakeWindow, innerHeight: 300 });
  const stop = trapMenu(b, () => {});
  expect(style.maxHeight, "the hook sets it from the menu's own box").toBe("282px");
  stop();
});
