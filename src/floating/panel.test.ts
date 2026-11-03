// TERM-059 / TERM-061 / TERM-052 / T-093-a: the floating panel's tabs, close rules and keys.
import { expect, test } from "vitest";
import { add, answer, asked, close, closeKey, empty, focused, isTrusted, KEY_BASE, liveTerminalTabs, modalHolds, programExited, reorder, route, saved, saveTarget, select, selectNumber, setDirty, show, hide, startFolder, step, toggle, trust, type Panel } from "./panel";

const three = (): Panel => {
  let p = empty();
  p = add(p, { kind: "terminal" });
  p = add(p, { kind: "browser" });
  p = add(p, { kind: "markdown", path: "C:\\notes\\a.md" });
  return p;
};
const keys = (p: Panel) => p.tabs.map((t) => t.key);

test("TERM-059: the toggle opens then closes the panel, and opening an empty panel makes no terminal", () => {
  const p0 = empty();
  const p1 = toggle(p0);
  expect(p1.open).toBe(true);
  expect(p1.tabs).toEqual([]);
  expect(toggle(p1).open).toBe(false);
  expect(hide(show(p0))).toEqual({ ...p0, open: false, focus: null });
});

test("TERM-059: opening puts typing focus in the active tab straight away", () => {
  const p = hide(three());
  const opened = toggle(p);
  expect(opened.focus).toBe(opened.active);
  expect(focused(opened).focus).toBeNull();
});

test("TERM-061: a new tab (an agent started from the panel too) is selected and focused, and opens a closed panel", () => {
  const p = add(hide(three()), { kind: "agent", agent: "claude" });
  expect(p.open).toBe(true);
  expect(p.active).toBe(p.tabs[3].key);
  expect(p.focus).toBe(p.active);
  expect(p.tabs[3].title).toBe("claude");
  expect(p.tabs[0].key).toBe(KEY_BASE);
});

test("TERM-061: tabs can be reordered, and cycling then follows the new order", () => {
  let p = three();
  const [a, b, c] = keys(p);
  p = reorder(p, c, 0);
  expect(keys(p)).toEqual([c, a, b]);
  p = select(p, c);
  expect(step(p, 1, "all").active).toBe(a);
  expect(step(p, -1, "all").active).toBe(b);
  expect(reorder(p, 999, 0)).toBe(p);
  expect(keys(reorder(p, a, 99))).toEqual([c, b, a]);
});

test("TERM-052: with 3 tabs the 2 shortcut selects the middle tab and the 5 shortcut does nothing", () => {
  const p = three();
  const [, b] = keys(p);
  expect(selectNumber(p, 2).active).toBe(b);
  expect(selectNumber(p, 5)).toBe(p);
  expect(selectNumber(p, 0)).toBe(p);
});

test("TERM-061: closing the last tab leaves the panel open on its empty state", () => {
  let p = add(empty(), { kind: "terminal" });
  p = close(p, [p.active as number]);
  expect(p.open).toBe(true);
  expect(p.tabs).toEqual([]);
  expect(p.active).toBeNull();
});

test("TERM-061: closing the active tab selects the one that took its place, else the one before", () => {
  const p = three();
  const [a, b, c] = keys(p);
  expect(close(select(p, b), [b]).active).toBe(c);
  expect(close(p, [c]).active).toBe(b); // c was active (last added)
  expect(close(select(p, a), [a]).active).toBe(b);
  expect(close(select(p, a), [c]).active).toBe(a); // closing another tab leaves the selection
});

test("TERM-061: closing an unsaved markdown tab asks first; discard closes it, keep leaves everything", () => {
  let p = three();
  const md = keys(p)[2];
  p = setDirty(p, md, true);
  const asking = close(p, [md]);
  expect(asking.tabs).toHaveLength(3);
  expect(asked(asking)?.key).toBe(md);
  expect(answer(asking, "keep").tabs).toHaveLength(3);
  expect(answer(asking, "keep").asking).toEqual([]);
  const gone = answer(asking, "discard");
  expect(gone.tabs).toHaveLength(2);
  expect(asked(gone)).toBeNull();
});

test("TERM-061: several unsaved markdown tabs are asked about one at a time; keep cancels the rest", () => {
  let p = empty();
  p = add(p, { kind: "markdown", path: "a.md" });
  p = add(p, { kind: "terminal" });
  p = add(p, { kind: "markdown", path: "b.md" });
  const [m1, t, m2] = keys(p);
  p = setDirty(setDirty(p, m1, true), m2, true);
  p = close(p, [m1, t, m2]);
  expect(keys(p)).toEqual([m1, m2]); // the clean terminal went at once
  expect(asked(p)?.key).toBe(m1);
  const next = answer(p, "discard");
  expect(asked(next)?.key).toBe(m2);
  expect(answer(next, "keep").tabs.map((x) => x.key)).toEqual([m2]);
  expect(answer(empty(), "discard")).toEqual(empty());
});

test("TERM-061: a program exiting on its own keeps its tab, apart from the user closing it", () => {
  const p = three();
  const t = keys(p)[0];
  const ended = programExited(p, t);
  expect(ended.tabs).toHaveLength(3);
  expect(ended.tabs[0].exited).toBe(true);
  expect(close(ended, [t]).tabs).toHaveLength(2);
});

test("TERM-061: Mod+W on an empty panel minimizes it; with tabs it closes the active one", () => {
  const e = show(empty());
  expect(closeKey(e).open).toBe(false);
  const p = three();
  const after = closeKey(p);
  expect(after.open).toBe(true);
  expect(after.tabs).toHaveLength(2);
});

test("TERM-061: floating terminals start in the home folder, and trusted folders are remembered", () => {
  expect(startFolder("C:\\Users\\a")).toBe("C:\\Users\\a");
  expect(startFolder("C:\\Users\\a", "  ")).toBe("C:\\Users\\a");
  expect(startFolder("C:\\Users\\a", "D:\\work")).toBe("D:\\work");
  let p = empty();
  expect(isTrusted(p, "D:\\work")).toBe(false);
  p = trust(trust(p, "D:\\work"), "D:\\work");
  expect(p.trusted).toEqual(["D:\\work"]);
  expect(isTrusted(p, "D:\\work")).toBe(true);
});

test("T-093-a: Mod+S saves only the floating editor's file, only with focus in the open panel", () => {
  const p = three(); // the markdown tab is active
  const md = keys(p)[2];
  expect(saveTarget(p, true)).toBe(md);
  expect(saveTarget(p, false)).toBeNull(); // focus is in the main window: its own editor saves
  expect(saveTarget(hide(p), true)).toBeNull();
  expect(saveTarget(select(p, keys(p)[0]), true)).toBeNull(); // a terminal tab has nothing to save
  expect(route("editor.save", undefined, true, true)).toEqual({ op: "save" });
  expect(route("editor.save", undefined, true, false)).toBeNull();
});

test("TERM-059/060: the panel commands work anywhere; tab commands only inside the open panel and never fall through", () => {
  expect(route("floatingTerminal.toggle", undefined, false, false)).toEqual({ op: "toggle" });
  expect(route("floatingWorkspace.maximize", undefined, true, false)).toEqual({ op: "maximize" });
  expect(route("floatingWorkspace.maximize", undefined, false, false)).toBeNull();
  expect(route("floatingWorkspace.minimize", undefined, true, true)).toEqual({ op: "minimize" });
  expect(route("tab.close", undefined, true, false)).toBeNull();
  expect(route("tab.close", undefined, true, true)).toEqual({ op: "close" });
  expect(route("tab.selectByIndex", 1, true, true)).toEqual({ op: "select", n: 2 });
  expect(route("tab.reopenClosed", undefined, true, true)).toEqual({ op: "none" });
  expect(route("app.settings", undefined, true, true)).toBeNull();
  expect(route("tab.nextAllTypes", undefined, true, true)).toEqual({ op: "step", by: 1, mode: "all" });
});

// After-list row 142: Save in the close question read the panel's mirrored dirty flag right after the save
// (which can lag) and discarded whatever tab was asked about by then.
test("TERM-061: Save closes the asked tab once its buffer is clean, even while the panel's own flag still says unsaved", () => {
  let p = empty();
  p = add(p, { kind: "markdown", path: "a.md" });
  const a = p.tabs[0].key;
  p = close(setDirty(p, a, true), [a]);
  expect(asked(p)?.key).toBe(a);
  const after = saved(p, a, false); // the buffer is clean; the panel flag has not caught up
  expect(after.tabs).toHaveLength(0);
  expect(asked(after)).toBeNull();
  // A refused or unnamed save keeps the question and the tab.
  expect(saved(p, a, true)).toBe(p);
});

test("TERM-061: Save never closes a different tab when the question moved on during the save", () => {
  let p = empty();
  p = add(p, { kind: "markdown", path: "a.md" });
  p = add(p, { kind: "markdown", path: "b.md" });
  const [a, b] = p.tabs.map((t) => t.key);
  p = close(setDirty(setDirty(p, a, true), b, true), [a, b]);
  expect(asked(p)?.key).toBe(a);
  const moved = answer(p, "discard"); // Don't save on a while its save was still running; b is asked now
  expect(asked(moved)?.key).toBe(b);
  const after = saved(moved, a, false); // a's save finishes late
  expect(after.tabs.map((t) => t.key)).toEqual([b]);
  expect(asked(after)?.key).toBe(b);
});

test("UX audit destructive F4: only started, unexited terminals and agents are checked before a tab closes", () => {
  let p = empty();
  p = add(p, { kind: "terminal" }); // 1000000: running
  p = add(p, { kind: "browser" });
  p = add(p, { kind: "agent", agent: "claude" }); // exited, and still checked (it may have started again)
  p = add(p, { kind: "terminal" }); // not started yet
  p = add(p, { kind: "markdown", path: "C:\\notes\\a.md" });
  const [term, web, agent, fresh, note] = keys(p);
  p = programExited(p, agent);
  const ptys = { [term]: 7, [web]: 8, [agent]: 9, [note]: 10 };
  expect(liveTerminalTabs(p, keys(p), ptys)).toEqual({ keys: [term, agent], ids: [7, 9] });
  expect(liveTerminalTabs(p, [fresh], ptys)).toEqual({ keys: [], ids: [] });
  expect(liveTerminalTabs(p, [999], ptys)).toEqual({ keys: [], ids: [] });
});

test("UX audit destructive: a tab that exited and then started again is still counted before it closes", () => {
  let p = empty();
  p = add(p, { kind: "agent", agent: "claude" });
  const [agent] = keys(p);
  p = programExited(p, agent); // the agent quit; Enter in the pane starts a shell in the same tab, and the mark stays
  expect(p.tabs[0].exited).toBe(true);
  expect(liveTerminalTabs(p, [agent], { [agent]: 21 })).toEqual({ keys: [agent], ids: [21] });
});

test("UX audit destructive F4: a terminal that fails to start stays as an exited tab, its error readable (TERM-061)", () => {
  let p = empty();
  p = add(p, { kind: "terminal" });
  p = add(p, { kind: "terminal" });
  const [a, b] = keys(p);
  p = programExited(p, a); // what FloatingLayer onFailed now does, instead of closing the tab
  expect(p.tabs.map((t) => t.key)).toEqual([a, b]);
  expect(p.tabs[0].exited).toBe(true);
});

test("UX audit destructive: while a layer dialog is up every chord but Escape is the dialog's, plain keys stay plain", () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  expect(modalHolds(true, k("w", { ctrlKey: true }))).toBe(true);
  expect(modalHolds(true, k("w", { metaKey: true }))).toBe(true);
  expect(modalHolds(true, k("a", { altKey: true, ctrlKey: true }))).toBe(true);
  expect(modalHolds(true, k("F5"))).toBe(true);
  expect(modalHolds(true, k("Escape"))).toBe(false);
  expect(modalHolds(true, k("Escape", { ctrlKey: true }))).toBe(false);
  expect(modalHolds(true, k("Tab"))).toBe(false);
  expect(modalHolds(true, k("Enter"))).toBe(false);
  expect(modalHolds(false, k("w", { ctrlKey: true }))).toBe(false);
});
