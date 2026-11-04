// T-702 (DT-C138): the audit's live harness skipped 20 controls on the right sidebar's Explorer tab
// (findings/live-wave3-b.md, S21). Each one is driven here through its real handler in the mounted
// Explorer and its content search, and the test asserts what the person sees change.
import { createElement, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeNode, byLabel, click, find, fire, installDom, mount, settle, typeInto, until, type FakeDocument } from "../tasks/fakeDom";

type Node = { name: string; path: string; kind: "dir" | "file" };
const f = (path: string): Node => ({ name: path.split("/").pop()!, path, kind: "file" });
const d = (path: string): Node => ({ name: path.split("/").pop()!, path, kind: "dir" });
const TREE: Record<string, Node[]> = {
  "/r": [d("/r/src"), f("/r/.env"), f("/r/dist.js"), f("/r/readme.md")],
  "/r/src": [f("/r/src/a.ts")],
};
const FOUND = { files: [{ path: "src/a.ts", hits: [{ line: 3, col: 2, before: "x ", text: "foo", after: " y", len: 3 }] }], total: 1, capped: false, source: "rg" };

const calls: Array<[string, Record<string, unknown>]> = [];
let gate: Promise<void> | null = null; // while set, dir_list waits for it (to see the refresh in progress)
let trashReply: unknown = null; // what fs_trash answers (a refusal, in the undo test)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push([cmd, args]);
    if (cmd === "dir_list") {
      if (gate) await gate;
      return TREE[args.path as string] ?? [];
    }
    if (cmd === "dir_ignored") return args.path === "/r" ? ["dist.js"] : [];
    if (cmd === "fs_create") return { path: `${args.dir}/${args.name}`, id: "v1", error: null };
    if (cmd === "fs_rename") {
      const from = String(args.path);
      return { path: from.slice(0, Math.max(from.lastIndexOf("/"), from.lastIndexOf("\\")) + 1) + String(args.name), id: "v2", error: null };
    }
    if (cmd === "fs_trash") return trashReply ?? [];
    if (cmd === "editor_search") return FOUND;
    if (cmd === "get_settings") return {};
    return null;
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));

let doc: FakeDocument;
let store: Map<string, string>;
beforeEach(() => {
  calls.length = 0;
  gate = null;
  trashReply = null;
  const dom = installDom();
  doc = dom.doc;
  store = dom.store;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800 });
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = dom.win.localStorage;
  g.HTMLElement = FakeNode; // the menu keys remember their opener with an instanceof check
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  (doc as unknown as { visibilityState: string }).visibilityState = "visible";
  const proto = FakeNode.prototype as unknown as Record<string, unknown>;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 24, bottom: 24, width: 24, height: 24 });
  proto.setSelectionRange = () => {};
  proto.select = () => {};
  // The Open in menu's keys (menuNav) look up its rows and whether it sits in a hidden panel.
  proto.querySelectorAll = function (this: FakeNode) {
    return find(this, (n) => (n.attrs.role ?? "").startsWith("menuitem"));
  };
  proto.closest = () => null;
  proto.querySelector = () => null;
});

const names = (root: FakeNode) => find(root, (n) => n.attrs.class === "ex-name").map((n) => n.textContent);
const button = (root: FakeNode, label: string) => {
  const b = byLabel(root, "button", label)[0];
  if (!b) throw new Error(`no button named ${label}`);
  return b;
};
const input = (root: FakeNode, label: string) => byLabel(root, "input", label)[0];

async function explorer(onClose = () => {}, strict = false) {
  const { default: Explorer } = await import("./Explorer");
  const onOpen = vi.fn();
  const view = createElement(Explorer, { root: "/r", hidden: false, focusAsk: 0, onOpen, onClose });
  const m = await mount(strict ? createElement(StrictMode, null, view) : view, doc);
  await until(() => names(m.container).includes("readme.md"), "the tree to load");
  return { ...m, onOpen };
}

describe("T-702 Explorer header", () => {
  it("Refresh the tree reads the shown folders again, busy and spinning until they are back", async () => {
    const { container } = await explorer();
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const before = calls.filter(([c]) => c === "dir_list").length;
    await click(container, button(container, "Refresh the tree"));
    const b = button(container, "Refresh the tree");
    expect(b.attrs["aria-busy"]).toBe("true");
    expect("disabled" in b.attrs || b.disabled === true).toBe(true);
    expect(find(b, (n) => (n.attrs.class ?? "").includes("spin")).length).toBe(1);
    expect(calls.filter(([c]) => c === "dir_list").length).toBeGreaterThan(before);
    open();
    await until(() => button(container, "Refresh the tree").attrs["aria-busy"] === "false", "the refresh to end");
    expect(find(button(container, "Refresh the tree"), (n) => (n.attrs.class ?? "").includes("spin")).length).toBe(0);
  });

  it("Expand all folders opens every folder; Collapse all folders closes them again", async () => {
    const { container } = await explorer();
    expect(names(container)).not.toContain("a.ts");
    await click(container, button(container, "Expand all folders"));
    await until(() => names(container).includes("a.ts"), "src to open");
    expect(button(container, "Expand all folders").attrs["aria-busy"]).toBe("false");
    await click(container, button(container, "Collapse all folders"));
    await until(() => !names(container).includes("a.ts"), "the folders to close");
  });

  it("Hide dotfiles flips aria-pressed, drops the dot names from the tree and is kept per worktree", async () => {
    const { container } = await explorer();
    const b = () => button(container, "Hide dotfiles");
    expect(b().attrs["aria-pressed"]).toBe("false");
    await click(container, b());
    expect(b().attrs["aria-pressed"]).toBe("true");
    expect(b().attrs.title).toBe("Dotfiles are hidden; click to show them");
    expect(names(container)).not.toContain(".env");
    expect(store.get("kolux.explorer.hideDotfiles")).toContain("/r");
    await click(container, b());
    expect(b().attrs["aria-pressed"]).toBe("false");
    expect(names(container)).toContain(".env");
  });

  it("Hide git-ignored files flips aria-pressed, asks git and drops the ignored names", async () => {
    const { container } = await explorer();
    const b = () => button(container, "Hide git-ignored files");
    await click(container, b());
    expect(b().attrs["aria-pressed"]).toBe("true");
    await until(() => !names(container).includes("dist.js"), "the ignored file to go");
    expect(calls.some(([c, a]) => c === "dir_ignored" && a.path === "/r")).toBe(true);
    await click(container, b());
    expect(b().attrs["aria-pressed"]).toBe("false");
    expect(names(container)).toContain("dist.js");
  });

  it("New file and New folder open a named draft row, and Enter creates it", async () => {
    const { container } = await explorer();
    await click(container, button(container, "New file"));
    const file = input(container, "New file name");
    expect(file).toBeTruthy();
    await typeInto(container, file, "b.ts");
    await fire(container, "keydown", file, { key: "Enter" });
    await until(() => calls.some(([c]) => c === "fs_create"), "the file to be created");
    expect(calls.find(([c]) => c === "fs_create")![1]).toEqual({ dir: "/r", name: "b.ts", folder: false });
    expect(input(container, "New file name")).toBeUndefined();

    await click(container, button(container, "New folder"));
    const folder = input(container, "New folder name");
    expect(folder).toBeTruthy();
    await typeInto(container, folder, "lib");
    await fire(container, "keydown", folder, { key: "Enter" });
    await until(() => calls.filter(([c]) => c === "fs_create").length === 2, "the folder to be created");
    expect(calls.filter(([c]) => c === "fs_create")[1][1]).toEqual({ dir: "/r", name: "lib", folder: true });
  });

  it("undo of a new file hands back the entry it made, and a changed file is refused with the reason shown", async () => {
    const { container } = await explorer();
    await click(container, button(container, "New file"));
    const field = input(container, "New file name");
    await typeInto(container, field, "notes.md");
    await fire(container, "keydown", field, { key: "Enter" });
    await until(() => calls.some(([c]) => c === "fs_create"), "the file to be created");
    await settle(); // the create's answer is recorded before the undo is pressed
    // The path now holds another entry (an agent wrote its own notes.md): the command refuses.
    trashReply = [{ path: "/r/notes.md", permanent: false, error: "notes.md changed since that action, so it was not undone" }];
    const tree = find(container, (n) => n.attrs.role === "tree")[0];
    const undo = () => fire(container, "keydown", tree, { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false });
    await undo();
    await until(() => container.textContent.includes("changed since that action"), "the refusal to show");
    // The undo carried the identity fs_create returned, not just the path.
    expect(calls.find(([c]) => c === "fs_trash")![1]).toEqual({ paths: ["/r/notes.md"], expect: ["v1"], mustBeEmpty: [false] });
    expect(container.textContent).toContain("notes.md changed since that action, so it was not undone");
    // The refused step is dropped rather than retried, so the rest of the history still undoes.
    await undo();
    await settle();
    expect(calls.filter(([c]) => c === "fs_trash").length).toBe(1);
    expect(calls.some(([c]) => c === "fs_restore")).toBe(false);
  });

  it("Open in opens its menu of apps (aria-expanded), and a second click closes it", async () => {
    const { container } = await explorer();
    await click(container, button(container, "Open in"));
    await until(() => find(container, (n) => n.attrs.role === "menu" && n.attrs["aria-label"] === "Open in").length === 1, "the menu");
    expect(button(container, "Open in").attrs["aria-expanded"]).toBe("true");
    expect(find(container, (n) => n.attrs.role === "menuitem").length).toBeGreaterThan(0);
    await click(container, button(container, "Open in"));
    expect(find(container, (n) => n.attrs.role === "menu" && n.attrs["aria-label"] === "Open in").length).toBe(0);
  });

  it("Hide the explorer calls onClose", async () => {
    const onClose = vi.fn();
    const { container } = await explorer(onClose);
    await click(container, button(container, "Hide the explorer"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Search file contents swaps the tree for the search (aria-pressed, title) and back", async () => {
    const { container } = await explorer();
    const tree = () => find(container, (n) => n.attrs.role === "tree")[0];
    const search = () => find(container, (n) => n.attrs.role === "search")[0];
    await click(container, button(container, "Search file contents"));
    expect(button(container, "Search file contents").attrs["aria-pressed"]).toBe("true");
    expect(find(container, (n) => n.attrs.class === "title")[0].textContent).toBe("Search");
    expect("hidden" in tree().attrs).toBe(true);
    expect("hidden" in search().attrs).toBe(false);
    expect(input(container, "Filter files by name")).toBeUndefined();
    await click(container, button(container, "Search file contents"));
    expect(button(container, "Search file contents").attrs["aria-pressed"]).toBe("false");
    expect("hidden" in tree().attrs).toBe(false);
    expect("hidden" in search().attrs).toBe(true);
  });
});

describe("T-702 Explorer name filter", () => {
  it("Filter files by name narrows the rows, says when nothing matches, and Clear the filter empties it", async () => {
    const { container } = await explorer();
    await typeInto(container, input(container, "Filter files by name"), "read");
    expect(names(container)).toEqual(["readme.md"]);
    await typeInto(container, input(container, "Filter files by name"), "zzz");
    expect(names(container)).toEqual([]);
    expect(container.textContent).toContain("No file name matches the filter.");
    await click(container, button(container, "Clear the filter"));
    expect(input(container, "Filter files by name").value).toBe("");
    expect(names(container)).toContain("readme.md");
    expect(byLabel(container, "button", "Clear the filter")).toEqual([]);
  });
});

describe("T-702 content search", () => {
  const asks = () => calls.filter(([c]) => c === "editor_search").map(([, a]) => a.ask as Record<string, unknown>);
  async function searchView() {
    const { default: ContentSearch } = await import("./ContentSearch");
    const onOpen = vi.fn();
    const m = await mount(createElement(ContentSearch, { root: "/r", hidden: false, focusAsk: 0, onOpen }), doc);
    return { ...m, onOpen };
  }
  // The search waits 250 ms after the last change.
  const searched = (n: number) => until(() => asks().length >= n, `search ${n}`).catch(() => settle(300)).then(() => until(() => asks().length >= n, `search ${n}`));

  it("Search text searches as you type and shows the summary and hits", async () => {
    const { container } = await searchView();
    await typeInto(container, input(container, "Search text"), "foo");
    await searched(1);
    expect(asks()[0]).toMatchObject({ query: "foo", matchCase: false, wholeWord: false, regex: false, include: "", exclude: "" });
    await until(() => find(container, (n) => n.attrs.role === "status")[0]?.textContent === "1 result in 1 file.", "the summary");
    expect(find(container, (n) => n.attrs.class === "cs-path")[0].textContent).toBe("src/a.ts");
  });

  it.each([
    ["Match case", "matchCase"],
    ["Whole word", "wholeWord"],
    ["Regular expression", "regex"],
  ])("%s flips aria-pressed and searches again with it on", async (label, key) => {
    const { container } = await searchView();
    await typeInto(container, input(container, "Search text"), "foo");
    await searched(1);
    expect(button(container, label).attrs["aria-pressed"]).toBe("false");
    await click(container, button(container, label));
    expect(button(container, label).attrs["aria-pressed"]).toBe("true");
    await searched(2);
    expect(asks()[1][key]).toBe(true);
  });

  it.each([
    ["Files to include", "include", "*.ts"],
    ["Files to exclude", "exclude", "dist/**"],
  ])("%s narrows the next search", async (label, key, glob) => {
    const { container } = await searchView();
    await typeInto(container, input(container, "Search text"), "foo");
    await searched(1);
    await typeInto(container, input(container, label), glob);
    expect(input(container, label).value).toBe(glob);
    await searched(2);
    expect(asks()[1][key]).toBe(glob);
  });

  it("a file row folds its hits, and a hit opens the file", async () => {
    const { container, onOpen } = await searchView();
    await typeInto(container, input(container, "Search text"), "foo");
    await until(() => find(container, (n) => n.attrs.class === "cs-hit").length === 1, "the hit");
    const fileRow = () => find(container, (n) => n.attrs.class === "cs-name")[0];
    expect(fileRow().attrs["aria-expanded"]).toBe("true");
    await click(container, find(container, (n) => n.attrs.class === "cs-hit")[0]);
    expect(onOpen).toHaveBeenCalledWith("/r/src/a.ts");
    await click(container, fileRow());
    expect(fileRow().attrs["aria-expanded"]).toBe("false");
    expect(find(container, (n) => n.attrs.class === "cs-hit").length).toBe(0);
  });
});

describe("T-710 Explorer row menu from the keyboard", () => {
  /** The tree, its menus, and the page laid out: the list spans 0-600 and row 0's box is `row` (null: not drawn). */
  async function rowMenu(row: { left: number; top: number; bottom: number } | null, strict = false) {
    const m = await explorer(undefined, strict);
    const tree = find(m.container, (n) => n.attrs.role === "tree")[0];
    Object.assign(tree, { getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 600 }) });
    (doc as unknown as Record<string, unknown>).getElementById = (id: string) =>
      id === "ex-row-0" && row ? { getBoundingClientRect: () => row } : null;
    await fire(m.container, "focusin", tree); // the list takes focus: its first row is active
    await settle();
    return { ...m, tree, menus: () => find(m.container, (n) => n.attrs.role === "menu") };
  }

  it("Shift+F10 on the focused list opens the active row's menu under that row; a right-click on blank list opens none", async () => {
    const { container, tree, menus } = await rowMenu({ left: 40, top: 96, bottom: 120 });
    expect(tree.attrs["aria-activedescendant"]).toBe("ex-row-0");
    await fire(container, "contextmenu", tree, { button: 2, clientX: 300, clientY: 400 });
    await settle();
    expect(menus().length, "a mouse right-click on blank list").toBe(0);
    // The engine raises contextmenu for Shift+F10 / the Menu key on the focused element, with button -1.
    await fire(container, "contextmenu", tree, { button: -1, clientX: 100, clientY: 30 });
    await until(() => menus().length === 1, "the row menu");
    expect(menus()[0].attrs["aria-label"]).toBe("Actions for src");
    expect([menus()[0].style.left, menus()[0].style.top]).toEqual(["56px", "120px"]);
  });

  it.each([
    ["scrolled out of", { left: 40, top: 900, bottom: 924 }],
    ["clipped at the bottom of", { left: 40, top: 590, bottom: 614 }],
  ])("T-720: an active row %s the list puts the menu at the event's point, not outside the tree", async (_, row) => {
    const { container, tree, menus } = await rowMenu(row);
    await fire(container, "contextmenu", tree, { button: -1, clientX: 100, clientY: 30 });
    await until(() => menus().length === 1, "the row menu");
    expect([menus()[0].style.left, menus()[0].style.top]).toEqual(["100px", "30px"]);
  });

  it("T-720: Escape closes the row menu and gives focus back to the list (under StrictMode too); the arrows move between its rows", async () => {
    const keys: Array<(e: unknown) => void> = [];
    Object.assign(globalThis.window, {
      addEventListener: (t: string, fn: (e: unknown) => void) => t === "keydown" && keys.push(fn),
      removeEventListener: (t: string, fn: (e: unknown) => void) => t === "keydown" && keys.includes(fn) && keys.splice(keys.indexOf(fn), 1),
    });
    const proto = FakeNode.prototype as unknown as Record<string, unknown>;
    proto.focus = function (this: FakeNode) {
      doc.activeElement = this;
    };
    const { container, tree, menus } = await rowMenu({ left: 40, top: 96, bottom: 120 }, true); // StrictMode: the dev double mount too
    Object.assign(tree, { isConnected: true });
    doc.activeElement = tree;
    await fire(container, "contextmenu", tree, { button: -1, clientX: 100, clientY: 30 });
    await until(() => menus().length === 1, "the row menu");
    const rows = find(menus()[0], (n) => (n.attrs.role ?? "").startsWith("menuitem"));
    expect(doc.activeElement, "focus on the first row").toBe(rows[0]);
    const press = async (key: string) => {
      const e = { key, shiftKey: false, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
      for (const fn of [...keys]) if (!e.stopped) fn(e);
      await settle();
    };
    await press("ArrowDown");
    expect(doc.activeElement, "Down: the next row").toBe(rows[1]);
    await press("Escape");
    expect(menus().length, "Escape closes").toBe(0);
    expect(doc.activeElement, "focus back on the list, not the page").toBe(tree);
  });

  it("T-720: WebKit's contextmenu for Shift+F10 (button 2, right after the key) opens the row menu too", async () => {
    const { noteMenuKey } = await import("../terminal/PaneMenu");
    const { container, tree, menus } = await rowMenu({ left: 40, top: 96, bottom: 120 });
    noteMenuKey({ key: "F10", shiftKey: true, timeStamp: Date.now() });
    await fire(container, "contextmenu", tree, { button: 2, clientX: 300, clientY: 400 });
    await until(() => menus().length === 1, "the row menu");
    expect([menus()[0].style.left, menus()[0].style.top]).toEqual(["56px", "120px"]);
  });
});
