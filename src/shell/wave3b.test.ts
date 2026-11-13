// T-696 (DT-C132): UX audit Wave 3 part B, lane D's rows, reproduced on the small DOM in src/tasks/fakeDom.ts
// before any change. G1 palette filters, G5 the Explorer shortcut, G6 the find bar, S24 the tab menu.
import { type FunctionComponent, act, createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeNode, byLabel, click, find, fire, installDom, mount, settle, typeInto, until } from "../tasks/fakeDom";
import type { Project, Worktree } from "../projects/model";
import { gridOrderOf } from "../terminal/pin";
import { TAB_COLORS } from "../terminal/tabColor";

const h = vi.hoisted(() => ({ lists: {} as Record<string, unknown[]>, win: {} as Record<string, unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => Promise.resolve(cmd === "workspace_list" ? (h.lists[String(args.projectId)] ?? []) : null),
}));
vi.mock("./window/store", () => ({ useWindow: () => h.win }));
// The src/ui wrappers as plain stand-ins (see S24 below): their keys, focus and placement are Base UI's.
vi.mock("../ui", async () => {
  const { createElement: el } = await import("react");
  type Kids = { children?: unknown };
  return {
    ContextMenu: ({ at, label, children }: Kids & { at: unknown; label: string }) => (at ? el("div", { role: "menu", "aria-label": label }, children as never) : null),
    MenuItem: ({ className = "menu-item", title, disabled, onClick, children }: Kids & { className?: string; title?: string; disabled?: boolean; onClick?: () => void }) =>
      el("button", { type: "button", role: "menuitem", className, title, "aria-disabled": disabled ? "true" : undefined, onClick: () => !disabled && onClick?.() }, children as never),
  };
});

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const src = (f: string) => nodeFs.readFileSync(new URL(f, import.meta.url), "utf8");

let unmount: () => Promise<void> = async () => {};
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});
async function show<P extends object>(type: FunctionComponent<P>, props: P) {
  const { doc } = installDom();
  const m = await mount(createElement(type as FunctionComponent<object>, props), doc);
  unmount = m.unmount;
  await settle();
  return m.container as FakeNode;
}
const chips = (c: FakeNode) => find(c, (n) => n.attrs.class === "palette-chip").map((n) => n.attrs["aria-label"]);

describe("G1 (not reproduced): the palette's filter selects add a chip, then go back to their prompt", () => {
  const w = (path: string, branch: string) => ({ path, branch, head: "abc1234", isMain: false, hidden: false, number: null, comment: "" }) as unknown as Worktree;
  beforeEach(() => {
    h.lists = { p1: [w("C:/w/app", "main"), w("C:/w/fix", "fix")] };
  });
  it("picking a repository or a kind adds its chip, the picked entry leaves the list, and the chip removes it again", async () => {
    const { default: WorktreePalette } = await import("../projects/WorktreePalette");
    const project = { id: "p1", name: "app", path: "C:/w/app" } as unknown as Project;
    const c = await show(WorktreePalette, { projects: [project], items: [], prOf: () => null, recent: [], scope: [], hasWorktree: true, onWorktree: () => {}, onCreate: () => {}, onClose: () => {} });
    const repo = byLabel(c, "select", "Filter by repository")[0];
    await until(() => repo.options.length > 1, "the repository options");
    expect(repo.options[0].textContent).toBe("+ Repository");
    repo.value = repo.options[1].value;
    await fire(c, "change", repo);
    await until(() => chips(c).length === 1, "the repository chip");
    expect(chips(c)).toEqual(["Remove the filter Repository: app"]);
    expect(byLabel(c, "select", "Filter by repository")[0].options.map((o) => o.value)).toEqual([""]);
    const kind = byLabel(c, "select", "Filter by kind")[0];
    kind.value = "Workspaces";
    await fire(c, "change", kind);
    await until(() => chips(c).length === 2, "the kind chip");
    expect(chips(c)[1]).toBe("Remove the filter Kind: Workspaces");
    expect(byLabel(c, "select", "Filter by kind")[0].options.map((o) => o.value)).not.toContain("Workspaces");
    await click(c, find(c, (n) => n.attrs["aria-label"] === "Remove the filter Kind: Workspaces")[0]);
    expect(chips(c)).toEqual(["Remove the filter Repository: app"]);
  });
});

describe("G5 (reproduced only with the content search open): Ctrl+Shift+E is a toggle", () => {
  it("a press with focus inside the open Explorer hides it; any other press shows and focuses it", () => {
    const plumbing = src("../settings/useSettingsPlumbing.ts");
    expect(plumbing).toContain(`if (explorerOpen && document.activeElement?.closest(".explorer")) return saveRight({ open: false });`);
    // the first press focuses the tree, which sits inside the .explorer panel, so the second press hides it
    const explorer = src("../editor/Explorer.tsx");
    expect(explorer.indexOf(`<aside className="explorer"`)).toBeLessThan(explorer.indexOf("ref={box}"));
    expect(src("../keys/keyScopes.ts")).toContain(`if (inTree) return ["global", "tabs"];`);
    // with the content search open, the press focuses the search box instead (also inside the panel)
    expect(explorer).toContain(`if (focusAsk && !hidden) searching ? setSearchAsk((n) => n + 1) : box.current?.focus();`);
  });
  it("its name in the palette and the shortcut list says it hides too", () => {
    expect(src("../keys/actions.ts")).toContain(`a("sidebar.explorer.toggle", "Show or hide Explorer", "global", ["Mod+Shift+E"])`);
  });
});

describe("G6: the find bar's Previous / Next", () => {
  beforeEach(() => {
    (FakeNode.prototype as unknown as { select?: () => void }).select ??= () => {}; // the bar selects its query on open
  });
  const bar = async (count: number, onStep = vi.fn()) => {
    const { default: FindBar } = await import("../terminal/FindBar");
    const c = await show(FindBar, { count, current: count ? 0 : -1, onSearch: () => {}, onStep, onClose: () => {} });
    return { c, onStep, prev: byLabel(c, "button", "Previous match")[0], next: byLabel(c, "button", "Next match")[0], status: find(c, (n) => n.attrs.role === "status")[0] };
  };
  it("with no matches the bar says so and the step buttons are greyed out", async () => {
    const { c, onStep, prev, next, status } = await bar(0);
    expect(prev.hasAttribute("disabled") && next.hasAttribute("disabled")).toBe(true);
    await click(c, next);
    expect(onStep).not.toHaveBeenCalled();
    const box = byLabel(c, "input", "Find")[0];
    await typeInto(c, box, "zzz");
    await until(() => status.textContent === "No matches", "No matches");
  });
  it("a step button that goes grey under the focus hands it back to the field", async () => {
    const { default: FindBar } = await import("../terminal/FindBar");
    const { doc } = installDom();
    let set: (n: number) => void = () => {};
    const Host = () => {
      const [count, setCount] = useState(3);
      set = setCount;
      return createElement(FindBar, { count, current: 0, onSearch: () => {}, onStep: () => {}, onClose: () => {} });
    };
    const m = await mount(createElement(Host), doc);
    unmount = m.unmount;
    const box = byLabel(m.container as FakeNode, "input", "Find")[0];
    const focus = vi.spyOn(box, "focus");
    await act(async () => set(0));
    expect(focus).toHaveBeenCalled();
  });
  it("with matches they step", async () => {
    const { c, onStep, prev, next } = await bar(3);
    expect(prev.hasAttribute("disabled") || next.hasAttribute("disabled")).toBe(false);
    await click(c, next);
    await click(c, prev);
    expect(onStep.mock.calls).toEqual([[1], [-1]]);
  });
});

// One session per cell (2026-11-12): the tab menu is a pane header's menu, drawn with the src/ui wrappers. Base UI needs
// a real DOM for its popup, so here the wrappers are plain stand-ins (a menu box, a button per row, a disabled row that
// ignores clicks, as Base UI's does); the rows, what each one does and that each closes the menu are the menu's own.
describe("S24: every item of the tab menu", () => {
  const panes = [1, 2, 3].map((key) => ({ key, cwd: "C:/w/app", kind: "editor" as string | undefined, path: `C:/w/app/f${key}.md` }));
  beforeEach(() => {
    h.win = {
      tabMenu: { key: 2, top: 10, left: 10 },
      panes,
      pinned: new Set<number>(),
      tabColors: {},
      orderOf: (key: number) => gridOrderOf(h.win.panes as typeof panes, key), // the window's own: the grid, cell by cell (C06-R1-01)
      setTabMenu: vi.fn(),
      setTabColors: vi.fn(),
      setPinned: vi.fn(),
      setAskName: vi.fn(),
      splitPane: vi.fn(),
      closeTab: vi.fn(() => Promise.resolve()),
    };
  });
  const open = async () => {
    const { default: TabMenuView } = await import("./window/TabMenuView");
    const c = await show(TabMenuView, {});
    const item = (name: string) => find(c, (n) => n.localName === "button" && (n.attrs.title === name || find(n, (k) => k.attrs.class === "name")[0]?.textContent === name))[0];
    return { c, item };
  };
  const fn = (k: string) => h.win[k] as ReturnType<typeof vi.fn>;

  it("lists the pin, color, split and close items for an editor pane, and Change Title first for a terminal", async () => {
    const { c } = await open();
    const names = find(c, (n) => n.attrs.class === "name").map((n) => n.textContent);
    expect(names).toEqual(["Pin tab", "Tab Color", "Split Right", "Split Down", "Close", "Close others", "Close to the right", "Close to the left", "Close all"]);
    expect(find(c, (n) => n.attrs.role === "menu")[0].attrs["aria-label"]).toBe("Tab");
    await unmount();
    h.win.panes = panes.map((p) => (p.key === 2 ? { ...p, kind: undefined } : p));
    const term = await open();
    expect(find(term.c, (n) => n.attrs.class === "name")[0].textContent).toBe("Change Title");
  });
  it("each head item does what it says and closes the menu", async () => {
    h.win.panes = panes.map((p) => (p.key === 2 ? { ...p, kind: undefined } : p));
    const { c, item } = await open();
    await click(c, item("Change Title"));
    expect(fn("setAskName").mock.calls[0][0]({ 2: 1 })).toEqual({ 2: 2 }); // the header's name field opens
    await click(c, item("Pin tab"));
    expect(fn("setPinned").mock.calls[0][0](new Set<number>())).toEqual(new Set([2]));
    await click(c, item("Split Right"));
    await click(c, item("Split Down"));
    expect(fn("splitPane").mock.calls).toEqual([[2, "right"], [2, "down"]]);
    const swatches = find(c, (n) => n.localName === "button" && /^swatch( on)?$/.test(n.attrs.class ?? ""));
    expect(swatches.map((n) => n.attrs.title)).toEqual(TAB_COLORS.map((t) => t.label));
    expect(swatches.map((n) => find(n, (k) => k.attrs.class === "swatch-name")[0].textContent)).toEqual(TAB_COLORS.map((t) => t.label)); // its name for a screen reader
    for (const s of swatches) await click(c, s);
    await click(c, item("No color"));
    const set = fn("setTabColors").mock.calls.map(([up]) => up({ 1: TAB_COLORS[0].id }));
    expect(set.slice(0, -1)).toEqual(TAB_COLORS.map((t) => ({ 1: TAB_COLORS[0].id, 2: t.id })));
    expect(set[set.length - 1]).toEqual({ 1: TAB_COLORS[0].id });
    expect(fn("setTabMenu").mock.calls.every(([v]) => v === null)).toBe(true);
    expect(fn("setTabMenu")).toHaveBeenCalledTimes(5 + TAB_COLORS.length);
  });
  it("a terminal's Tab Color… opens the colour rows alone", async () => {
    h.win.tabMenu = { key: 2, top: 10, left: 10, colors: true };
    const { c } = await open();
    expect(find(c, (n) => n.attrs.class === "name").map((n) => n.textContent)).toEqual(["Tab Color"]);
    expect(find(c, (n) => n.attrs.role === "menu")[0].attrs["aria-label"]).toBe("Tab Color");
  });
  it("each close item closes its own set; one with nothing to close does nothing", async () => {
    const { c, item } = await open();
    const sets: Record<string, number[]> = { "Close": [2], "Close others": [1, 3], "Close to the right": [3], "Close to the left": [1], "Close all": [1, 2, 3] };
    for (const [name, keys] of Object.entries(sets)) {
      fn("closeTab").mockClear();
      fn("setTabMenu").mockClear();
      await click(c, item(name));
      expect(fn("closeTab"), name).toHaveBeenCalledWith(keys);
      expect(fn("setTabMenu"), name).toHaveBeenCalledWith(null);
    }
    // a pane alone in its grid: nothing to its right; a full grid: no split
    h.win.panes = [panes[1], ...Array.from({ length: 23 }, (_, i) => ({ ...panes[0], key: 100 + i }))];
    await unmount();
    const again = await open();
    expect(again.item("Close to the left").attrs["aria-disabled"]).toBe("true");
    expect(again.item("Split Right").attrs["aria-disabled"]).toBe("true");
    expect(again.item("Split Right").attrs.title).toBe("A workspace holds up to 24 panes.");
    fn("closeTab").mockClear();
    fn("splitPane").mockClear();
    await click(again.c, again.item("Close to the left"));
    await click(again.c, again.item("Split Right"));
    expect(fn("closeTab")).not.toHaveBeenCalled();
    expect(fn("splitPane")).not.toHaveBeenCalled();
  });
  // C06-R1-01: the side rows follow the grid as drawn (one session per cell: a pinned pane keeps its cell), and a pinned
  // pane's own row stays off.
  it("C06-R1-01: a pinned pane's rows measure its grid as drawn", async () => {
    h.win.panes = [panes[1], { key: 9, cwd: "C:/elsewhere", kind: "editor", path: "x" }, panes[2], panes[0]]; // grid C:/w/app draws 2, 3, 1
    h.win.pinned = new Set([1]);
    h.win.tabMenu = { key: 1, top: 10, left: 10 };
    const { c, item } = await open();
    expect(item("Close").attrs["aria-disabled"]).toBe("true"); // a pinned pane's own row
    expect(item("Close to the right").attrs["aria-disabled"]).toBe("true"); // it is the last cell
    fn("closeTab").mockClear();
    await click(c, item("Close to the left"));
    expect(fn("closeTab")).toHaveBeenCalledWith([2, 3]); // the two drawn before it, never the other workspace's
  });
});
