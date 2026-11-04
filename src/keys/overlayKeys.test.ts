import { expect, test, vi } from "vitest";
import { actionById } from "./actions";
import { defaultsOnly } from "./keymap";
import { CHROME_FIRST, explorerSearchKey, focusChrome, heldByOverlay, menuAction, OVERLAYS, PANE_LOCAL, PANE_CLOSE_EVENT, paneCloseClaimed, STAYS_OPEN, WINDOW_BROWSER, WINDOW_TERMINAL } from "./useWindowKeys";

// UX lane C: global shortcuts wait while a menu, popover or dialog is up; the Settings page is a page.
const box = (shown: boolean, staysOpen = false) => ({ getClientRects: () => ({ length: shown ? 1 : 0 }), closest: () => null, matches: () => staysOpen });
const root = (overlays: unknown[], settings: unknown = null) => ({
  querySelector: (s: string) => (s.startsWith(".settings") ? settings : null),
  querySelectorAll: () => overlays,
});

test("a showing dialog or menu holds global shortcuts; none showing lets them run", () => {
  expect(heldByOverlay("tab.newTerminal", false, root([]) as never)).toBe(false);
  expect(heldByOverlay("tab.newTerminal", false, root([box(true)]) as never)).toBe(true);
  expect(heldByOverlay("tab.newTerminal", false, root([box(false)]) as never), "hidden").toBe(false);
});

test("a panel that stays open (floating workspace, agent question card, plan sheet) holds nothing", () => {
  expect(heldByOverlay("terminals.focusNextNeedsYou", false, root([box(true, true)]) as never)).toBe(false);
  expect(heldByOverlay("tab.newTerminal", false, root([box(true, true), box(true)]) as never), "a menu over it still holds").toBe(true);
});

test("the open Settings page alone holds nothing; a dialog inside it does", () => {
  const page = (inner: unknown[]) => root([box(true)], { querySelectorAll: () => inner });
  expect(heldByOverlay("sidebar.left.toggle", false, page([]) as never)).toBe(false);
  expect(heldByOverlay("sidebar.left.toggle", false, page([box(true)]) as never)).toBe(true);
});

// A just-enough element: class names and attributes, matched against the real selector lists (simple selectors only,
// which is all OVERLAYS and STAYS_OPEN use; a selector this cannot read fails the test instead of passing quietly).
type El = { cls: string[]; attrs: Record<string, string> };
const one = (el: El, s: string): boolean => {
  const m = s.trim().match(/^(\.[\w-]+)?(\[([\w-]+)(?:="([^"]*)")?\])?$/);
  if (!m || (!m[1] && !m[2])) throw new Error("selector the test cannot read: " + s);
  if (m[1] && !el.cls.includes(m[1].slice(1))) return false;
  if (m[3] && !(m[3] in el.attrs && (m[4] === undefined || el.attrs[m[3]] === m[4]))) return false;
  return true;
};
const matchesAny = (el: El, list: string) => list.split(",").some((s) => one(el, s));
const real = (cls: string, attrs: Record<string, string>, parent?: string) => {
  const el: El = { cls: cls.split(" "), attrs };
  const up: El[] = [el, ...(parent ? [{ cls: parent.split(" "), attrs: {} }] : [])];
  return { el, getClientRects: () => ({ length: 1 }), closest: (s: string) => up.find((x) => matchesAny(x, s)) ?? null, matches: (s: string) => matchesAny(el, s) };
};
const dom = (els: ReturnType<typeof real>[]) => ({
  querySelector: () => null,
  querySelectorAll: (s: string) => els.filter((x) => matchesAny(x.el, s)),
});

test("real markup: a docked tip, the hooks card, a tour and the floating panel hold nothing; a modal dialog does", () => {
  expect(OVERLAYS).toContain('[role="dialog"]');
  expect(STAYS_OPEN).toContain('[aria-modal="false"]');
  const tip = real("tip-card", { role: "dialog", "aria-modal": "false" }); // Guides.tsx docked Tip and the hooks consent card
  const tour = real("tour", { role: "dialog", "aria-modal": "false" }); // Tours.tsx
  const float = real("float-panel", { role: "dialog" });
  const cleanup = real("sb-form", { role: "dialog" }); // projects CleanupDialog, inline in the sidebar
  const prDraft = real("scm-ask scm-pr", { role: "dialog", "aria-label": "Create pull request" }); // scm/PrStart.tsx
  const resolve = real("scm-ask", { role: "dialog" }); // source control: resolve conflicts with an agent
  const grab = real("grab-sheet", { role: "dialog" }); // browser/GrabSheet.tsx, inside one browser pane
  const draw = real("draw-canvas", { role: "dialog" }); // browser/DrawCanvas.tsx, inside one browser pane
  const found = real("pick-list found-list", {}); // the create-worktree form's found issues, inside .sb-form
  const permission = real("chat-permission", { role: "alertdialog" }); // an inline permission card, not modal
  const modal = real("crash-report", { role: "dialog" });
  // The palette tip names the Switch workspace key: that key works while the tip shows.
  expect(heldByOverlay("worktree.palette", false, dom([tip, tour, float, cleanup]) as never)).toBe(false);
  for (const form of [prDraft, resolve, grab, draw, found, permission]) expect(heldByOverlay("tab.newTerminal", false, dom([form]) as never), form.el.cls.join(".")).toBe(false);
  expect(heldByOverlay("terminal.splitRight", false, dom([tour]) as never), "the tour's own step still splits").toBe(false);
  expect(heldByOverlay("worktree.palette", false, dom([tip, modal]) as never)).toBe(true);
  expect(heldByOverlay("tab.newTerminal", false, dom([real("menu", {})]) as never)).toBe(true);
  // chrome/Ask (the reload question, delete confirmations) and editor/CloseDialog: window-modal, behind .ask-backdrop
  const ask = real("ask", { role: "alertdialog", "aria-modal": "true" }, "ask-backdrop");
  // terminal/TerminalPane.tsx: a dead shell's exit code, Paste N lines? and an account notice cover one pane only
  const paneAsk = real("ask", { role: "alertdialog", "aria-modal": "true" }, PANE_LOCAL.slice(1));
  for (const id of ["tab.newTerminal", "tab.close", "tab.previousRecent", "terminals.focusNextNeedsYou", "tab.selectByIndex"]) {
    expect(heldByOverlay(id, false, dom([ask]) as never), id).toBe(true);
    expect(heldByOverlay(id, false, dom([paneAsk]) as never), "pane-local " + id).toBe(false);
  }
});

test("Move Focus to the Top Bar focuses the top bar's first enabled control", () => {
  expect(CHROME_FIRST).toMatch(/^header\[data-tauri-drag-region\] button:not\(:disabled\), /);
  const focus = vi.fn();
  let asked = "";
  focusChrome({ querySelector: ((s: string) => ((asked = s), { focus })) as never });
  expect(asked).toBe(CHROME_FIRST);
  expect(focus).toHaveBeenCalledTimes(1);
  expect(() => focusChrome({ querySelector: () => null })).not.toThrow(); // no top bar (classic layout)
});

test("the menu's Force Reload asks over unsaved text and reloads without; View > Space opens Space (Terminals in classic)", () => {
  const b = (unsaved: string[], classic = false) => ({ unsaved: { current: unsaved }, setReloadAsk: vi.fn(), setScreen: vi.fn(), classic });
  const reload = vi.fn();
  const dirty = b(["a.ts"]);
  menuAction("app.forceReload", dirty, reload);
  expect(dirty.setReloadAsk).toHaveBeenCalledWith(["a.ts"]);
  expect(reload).not.toHaveBeenCalled();
  menuAction("app.forceReload", b([]), reload);
  expect(reload).toHaveBeenCalledTimes(1);
  const s = b([]);
  menuAction("screen.space", s, reload);
  expect(s.setScreen).toHaveBeenCalledWith("space");
  const c = b([], true);
  menuAction("screen.space", c, reload);
  expect(c.setScreen).toHaveBeenCalledWith("terminals");
  menuAction("screen.agents", s, reload); // the other screens go through the settings plumbing, not here
  expect(s.setScreen).toHaveBeenCalledTimes(1);
});

test("a page's own browser chord, an editor or an explorer chord is not held: Ctrl+C in a browser pane still copies under a dialog", () => {
  expect(actionById.get("browser.grabElement")?.scope).toBe("browser");
  const modal = real("crash-report", { role: "dialog" });
  expect(heldByOverlay("browser.grabElement", false, dom([modal]) as never)).toBe(false);
  for (const id of ["tab.newTerminal", "terminal.splitRight", "worktree.palette"]) expect(heldByOverlay(id, false, dom([modal]) as never), id).toBe(true);
});

test("Terminals screen under the worktree palette: Ctrl+V and Ctrl+C reach the palette's field; a split still waits", () => {
  const palette = real("palette", { role: "dialog" });
  for (const id of ["terminal.paste", "terminal.copySelection", "terminal.selectAll"]) {
    expect(actionById.get(id)?.scope, id).toBe("terminal");
    expect(heldByOverlay(id, false, dom([palette]) as never), id).toBe(false);
  }
  expect(heldByOverlay("terminal.splitRight", false, dom([palette]) as never)).toBe(true);
  for (const id of WINDOW_TERMINAL) expect(actionById.get(id)?.scope, id).toBe("terminal");
});

test("under a dialog the browser chords the window runs itself wait (Ctrl+L stays in the dialog); a page's own Ctrl+C does not", () => {
  const modal = real("crash-report", { role: "dialog" });
  for (const id of WINDOW_BROWSER) {
    expect(actionById.get(id)?.scope, id).toBe("browser");
    expect(heldByOverlay(id, false, dom([modal]) as never), id).toBe(true);
    expect(heldByOverlay(id, false, dom([real("float-panel", { role: "dialog" })]) as never), id).toBe(false);
  }
  expect(heldByOverlay("browser.grabElement", false, dom([modal]) as never)).toBe(false);
});

test("the floating panel's own chords (Ctrl+Alt+A, maximize, minimize) wait under a modal, not under the panel itself", () => {
  const modal = real("crash-report", { role: "dialog" });
  const float = real("float-panel", { role: "dialog" });
  for (const id of ["floatingTerminal.toggle", "floatingWorkspace.maximize", "floatingWorkspace.minimize"]) {
    expect(heldByOverlay(id, false, dom([float, modal]) as never), id).toBe(true);
    expect(heldByOverlay(id, false, dom([float]) as never), id).toBe(false);
  }
});

test("Show Search (Mod+Shift+F) opens from a terminal that already cancelled the press; it waits under a dialog", () => {
  const map = defaultsOnly("win32");
  const press = { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, defaultPrevented: true };
  expect(explorerSearchKey(map, press, dom([]) as never), "cancelled by the terminal").toBe(true);
  expect(explorerSearchKey(map, press, dom([real("float-panel", { role: "dialog" })]) as never)).toBe(true);
  expect(explorerSearchKey(map, press, dom([real("crash-report", { role: "dialog" })]) as never), "under a dialog").toBe(false);
  expect(explorerSearchKey(map, { ...press, shiftKey: false }, dom([]) as never), "Ctrl+F is not Show Search").toBe(false);
});

test("the Ctrl+Tab list (itself a menu) still steps while it is open", () => {
  expect(heldByOverlay("tab.previousRecent", true, root([box(true)]) as never)).toBe(false);
  expect(heldByOverlay("tab.nextRecent", true, root([box(true)]) as never)).toBe(false);
  expect(heldByOverlay("tab.previousRecent", false, root([box(true)]) as never)).toBe(true);
});

test("Automations has a command, so the palette lists it", () => {
  expect(actionById.get("view.automations")?.title).toBe("Open Automations");
  expect(actionById.get("browser.hardReload")?.title).not.toMatch(/Hard/);
});

test("UX lane C (request from D): Ctrl+W closes directly unless the pane claims the close for its own warning", () => {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = new EventTarget();
  try {
    expect(paneCloseClaimed(1), "no pane listens: the window closes it").toBe(false);
    const claim = (e: Event) => { if ((e as CustomEvent<{ paneId: number }>).detail.paneId === 2) e.preventDefault(); };
    (g.window as EventTarget).addEventListener(PANE_CLOSE_EVENT, claim);
    expect(paneCloseClaimed(2), "the browser pane takes it").toBe(true);
    expect(paneCloseClaimed(1), "another pane still closes directly").toBe(false);
  } finally {
    g.window = before;
  }
});
