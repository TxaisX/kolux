// TERM-035 / TERM-025 / TERM-013: which items the pane menu offers and in what order, that Equalize
// and the rest appear only when they apply, Close Pane reads as destructive, the opening click does
// not dismiss, and the menu stays on screen.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import PaneMenu, { chooseItem, fitIn, fromKeys, menuKey, menuStep, noteMenuKey, OPEN_GUARD_MS, outsideDismisses, paneMenuItems, withChord, type MenuContext } from "./PaneMenu";
import pane from "./TerminalPane.tsx?raw";

const noop = () => {};
/** A pane that can do everything and is split, expandable, selected, titled, with an agent action. */
const full: MenuContext = {
  selected: true,
  expanded: false,
  canExpand: true,
  onCopy: noop,
  onSelectAll: noop,
  onPaste: noop,
  agentActions: [{ id: "review", name: "Review plan", run: noop }],
  onSplit: noop,
  onEqualize: noop,
  onExpand: noop,
  onSetTitle: noop,
  hasTitle: true,
  onClearTitle: noop,
  copyIds: [
    { id: "idSession", name: "Copy Session ID", run: noop },
    { id: "idTerminal", name: "Copy Terminal ID", run: noop },
    { id: "idPane", name: "Copy Pane ID", run: noop },
  ],
  onDiagnostics: noop,
  onClose: noop,
  onClear: noop,
  onFind: noop,
};
const names = (c: MenuContext) => paneMenuItems(c).map((i) => i.name);
const html = (c: MenuContext) => renderToString(createElement(PaneMenu, { style: {}, items: paneMenuItems(c), onDismiss: noop }));

test("TERM-035: the menu lists Copy, Select All, Paste; agent actions; splits, Equalize, Expand; title; ids; diagnostics; Clear Screen, Find; Close last, in that order", () => {
  expect(names(full)).toEqual([
    "Copy", "Select All", "Paste",
    "Review plan",
    "Split Right", "Split Down", "Equalize", "Expand",
    "Set Title…", "Clear Title", "Copy Session ID", "Copy Terminal ID", "Copy Pane ID", "Copy terminal diagnostics",
    "Clear Screen", "Find…", "Close Pane",
  ]);
});

test("TERM-035: in an unsplit pane the menu has no Equalize item", () => {
  expect(names({ ...full, onEqualize: undefined })).not.toContain("Equalize");
  expect(names(full)).toContain("Equalize");
});

test("TERM-035: items appear only when they apply (Copy needs a selection, Clear Title a title, Expand room, Close a way to close)", () => {
  const bare = names({ ...full, selected: false, hasTitle: false, canExpand: false, onClose: undefined, onSplit: undefined, agentActions: [], copyIds: [] });
  expect(bare).not.toContain("Copy");
  expect(bare).not.toContain("Clear Title");
  expect(bare).not.toContain("Expand");
  expect(bare).not.toContain("Close Pane");
  expect(bare).not.toContain("Split Right");
  expect(bare).toContain("Select All");
  expect(bare).toContain("Paste");
  expect(bare).toContain("Clear Screen");
});

test("TERM-013: an expanded pane's menu offers Collapse; a lone classic pane has no Expand item", () => {
  expect(names({ ...full, expanded: true })).toContain("Collapse");
  expect(names({ ...full, expanded: true })).not.toContain("Expand");
  expect(names({ ...full, canExpand: false })).not.toContain("Expand");
});

test("TERM-035: Close Pane is styled destructive and no other item is; shortcuts show only when assigned", () => {
  const items = paneMenuItems(full);
  expect(items.filter((i) => i.danger).map((i) => i.name)).toEqual(["Close Pane"]);
  const out = html(full);
  const close = out.split("<button").find((b) => b.includes("Close Pane"))!;
  expect(close).toContain("danger");
  expect(close).toContain("Ctrl+W");
  // Set Title has no default chord: no shortcut text beside it.
  const title = out.split("<button").find((b) => b.includes("Set Title"))!;
  expect(title).not.toContain('class="muted"');
  expect(out).toContain('role="separator"');
});

test("TERM-035: an item's action is what the menu offers for it", () => {
  const ran: string[] = [];
  const items = paneMenuItems({ ...full, onSplit: (d) => ran.push(`split ${d}`), onEqualize: () => ran.push("equalize"), onClose: () => ran.push("close") });
  for (const n of ["Split Right", "Split Down", "Equalize", "Close Pane"]) items.find((i) => i.name === n)!.run();
  expect(ran).toEqual(["split right", "split down", "equalize", "close"]);
});

test("FIX-1: chooseItem dismisses the menu first, then runs the item's action (Close Pane included); the menu renders one button per item", () => {
  const order: string[] = [];
  const items = paneMenuItems({ ...full, onSplit: (d) => order.push(`split ${d}`), onEqualize: () => order.push("equalize"), onClose: () => order.push("close") });
  for (const n of ["Split Right", "Equalize", "Close Pane"]) chooseItem(items.find((i) => i.name === n)!, () => order.push("dismiss"));
  expect(order).toEqual(["dismiss", "split right", "dismiss", "equalize", "dismiss", "close"]);
  // Markup only: one button per item. That a button's onClick calls chooseItem is read from PaneMenu.tsx, not proven here
  // (server rendering carries no handlers); the live proof clicks Close Pane (evidence/core-FIX-1.txt step 3).
  const out = renderToString(createElement(PaneMenu, { style: {}, items, onDismiss: noop }));
  expect(out.split("<button").length - 1).toBe(items.length);
});

test("TERM-035: the click that opened the menu does not close it; a later click does", () => {
  expect(outsideDismisses(1000, 1000)).toBe(false);
  expect(outsideDismisses(1000, 1000 + OPEN_GUARD_MS - 1)).toBe(false);
  expect(outsideDismisses(1000, 1000 + OPEN_GUARD_MS)).toBe(true);
});

test("TERM-035: a tall menu opened near the bottom or right edge is moved back inside the window", () => {
  expect(fitIn(900, 420, 1000)).toBe(572); // bottom edge: 1000 - 420 - 8
  expect(fitIn(1900, 240, 1920)).toBe(1672);
  expect(fitIn(100, 420, 1000)).toBe(100); // already fits
  expect(fitIn(-30, 420, 1000)).toBe(8); // never above the margin
  expect(fitIn(5, 2000, 1000)).toBe(8); // taller than the window: the top, then it scrolls
});

test("UX audit terminal F5: Close Pane is the last item and takes the danger token, not a hard-coded colour", () => {
  const items = paneMenuItems(full);
  expect(items[items.length - 1].name).toBe("Close Pane");
  expect(items[items.length - 1].group).not.toBe(items[items.length - 2].group);
  const out = html(full);
  expect(out).toContain("var(--danger)");
  expect(out).not.toContain("#f0a07a");
});

test("UX audit terminal F1: the menu names itself, a host can rename it, and its rows are menu items the arrows can walk", () => {
  expect(html(full)).toContain("aria-label=\"Pane menu\"");
  expect(renderToString(createElement(PaneMenu, { style: {}, items: paneMenuItems(full), onDismiss: noop, label: "New tab menu", layer: 70 }))).toContain("aria-label=\"New tab menu\"");
  const rows = paneMenuItems(full).length;
  expect(menuStep(rows, -1, "ArrowDown")).toBe(0);
  expect(menuStep(rows, rows - 1, "ArrowDown")).toBe(0);
  expect(menuStep(rows, 0, "ArrowUp")).toBe(rows - 1);
  expect(menuStep(rows, 3, "x")).toBeNull();
});

test("UX audit terminal F4: a header tooltip shows the chord the keymap has, and none when it has none", () => {
  expect(withChord("Close pane", ["Ctrl", "W"])).toBe("Close pane (Ctrl+W)");
  expect(withChord("Close pane", ["Cmd", "W"])).toBe("Close pane (Cmd+W)");
  expect(withChord("Close pane", [])).toBe("Close pane");
});

test("T-710: Shift+F10 and the Menu key are the menu keys; with Ctrl, Alt or Meta they stay the program's (T-720)", () => {
  expect([menuKey({ key: "F10", shiftKey: true }), menuKey({ key: "ContextMenu", shiftKey: false })]).toEqual([true, true]);
  expect([menuKey({ key: "F10", shiftKey: false }), menuKey({ key: "F9", shiftKey: true })]).toEqual([false, false]);
  expect([
    menuKey({ key: "F10", shiftKey: true, ctrlKey: true }),
    menuKey({ key: "F10", shiftKey: true, altKey: true }),
    menuKey({ key: "ContextMenu", shiftKey: false, metaKey: true }),
  ]).toEqual([false, false, false]);
});

test("T-720: a contextmenu is from the keyboard with button -1 (Chromium) or right after a menu key (WebKit's button 2)", () => {
  expect(fromKeys({ button: -1, timeStamp: 10 }), "Chromium marks it").toBe(true);
  expect(fromKeys({ button: 2, timeStamp: 10 }), "a right-click with no menu key before it").toBe(false);
  noteMenuKey({ key: "F9", shiftKey: true, timeStamp: 1000 });
  expect(fromKeys({ button: 2, timeStamp: 1010 }), "another key is not a menu key").toBe(false);
  noteMenuKey({ key: "F10", shiftKey: true, timeStamp: 2000 });
  expect(fromKeys({ button: 2, timeStamp: 2005 }), "WebKit: button 2 right after Shift+F10").toBe(true);
  expect(fromKeys({ button: 2, timeStamp: 2600 }), "a later right-click is the mouse again").toBe(false);
  noteMenuKey({ key: "ContextMenu", shiftKey: false, ctrlKey: true, timeStamp: 3000 });
  expect(fromKeys({ button: 2, timeStamp: 3005 }), "Ctrl+Menu is not a menu key").toBe(false);
});

test("T-710: the terminal hands the menu keys to the engine and opens the pane menu for a keyboard contextmenu", () => {
  // ponytail: wiring only (mounting TerminalPane needs xterm and the backend); the decisions are tested above.
  expect(pane).toMatch(/attachCustomKeyEventHandler\(\(e\) => \{\s*if \(menuKey\(e\)\) return false;/);
  expect(pane).toContain("if (fromKeys(e) || !hot || !opensMenu(");
  expect(pane).toContain("if (fromKeys(e)) return menuRef.current(e.clientX, e.clientY);");
  expect(pane).not.toContain("button < 0");
});
