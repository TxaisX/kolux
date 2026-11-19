// SET-008 / 009 / 010 / 011 / 013 acceptance: the product's KeymapProvider + ShortcutsPage on the fake DOM.
// The Rust side of ~/.kolux/keybindings.json (create, never write over a broken file, one command per write,
// reset) is proven by the in-crate tests in src-tauri/src/keybindings.rs; `fileHost` below is only a 5-line
// stand-in for its invoke commands, and every write payload is asserted exactly as the page sends it.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, typeInto, until } from "../../test/fakeDom";
import { SEEDED_FIELD } from "../../keys/tabKeysSeed";

const hoisted = vi.hoisted(() => ({ handler: (_c: string, _a?: unknown): Promise<unknown> => Promise.resolve(null) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (c: string, a?: unknown) => hoisted.handler(c, a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

vi.setConfig({ testTimeout: 60_000 }); // the whole shortcut table is drawn on a fake DOM
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type FileRead = { path: string; value: Any; created: boolean; error: string | null };
const file = (value: Any, error: string | null = null): FileRead => ({ path: "<home>/.kolux/keybindings.json", value, created: false, error });

let doc: FakeDocument;
let listeners: Record<string, Array<(e: Any) => void>>;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  listeners = {};
  const win = dom.win as Any;
  win.addEventListener = (t: string, fn: (e: Any) => void) => void (listeners[t] ??= []).push(fn);
  win.removeEventListener = (t: string, fn: (e: Any) => void) => void (listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn));
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

/** The window's invoke commands for the file; `writes` holds every keybindings_write payload. */
function fileHost(start: FileRead) {
  const host = { file: start, writes: [] as Any[] };
  hoisted.handler = async (cmd, args: Any) => {
    if (cmd === "keybindings_read") return host.file;
    if (cmd === "get_settings") return { [SEEDED_FIELD]: true };
    if (cmd !== "keybindings_write") return null;
    host.writes.push(args);
    const v = structuredClone(host.file.value ?? { version: 1, keybindings: {} });
    v.platforms ??= {};
    v.platforms.win32 ??= {};
    if (args.reset) delete v.platforms.win32[args.id];
    else v.platforms.win32[args.id] = args.value;
    host.file = { ...host.file, value: v };
    return host.file;
  };
  return host;
}

async function page(start: FileRead) {
  const host = fileHost(start);
  const { KeymapProvider, useKeymap } = await import("../../keys/KeymapContext");
  const { default: ShortcutsPage } = await import("../ShortcutsPage");
  let keymap: Any = null;
  const Probe = () => ((keymap = useKeymap()), null);
  const m = await mount(createElement(KeymapProvider, null, createElement(ShortcutsPage), createElement(Probe)), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await until(() => c.textContent.includes(start.path)); // the file has been read
  return { c, host, keymap: () => keymap };
}

const row = (c: FakeNode, id: string) => find(c, (n) => n.localName === "tr" && n.attrs["data-id"] === id)[0];
const ids = (c: FakeNode) => find(c, (n) => n.localName === "tr").map((n) => n.attrs["data-id"]);
const text = (n: FakeNode) => n.textContent.trim();
const chords = (r: FakeNode) => find(r, (n) => n.localName === "button" && String(n.attrs.class).startsWith("keys-chord")).map(text);
const BADGES = ["Modified", "Unassigned", "Disabled", "Conflicts"];
const badges = (r: FakeNode) => find(r, (n) => String(n.attrs.class).split(" ").includes("keys-badge")).map(text).filter((t) => BADGES.includes(t));
const button = (r: FakeNode, label: string) => find(r, (n) => n.localName === "button" && text(n) === label)[0];
const pickFilter = (c: FakeNode, label: string) => click(c, find(find(c, (n) => n.attrs.role === "radiogroup" && n.attrs["aria-label"] === "Show")[0], (n) => n.attrs.role === "radio" && text(n) === label)[0]);
const search = (c: FakeNode) => find(c, (n) => n.attrs["aria-label"] === "Search shortcuts")[0];

async function press(init: Record<string, unknown>) {
  const { act } = await import("react");
  const e = { type: "keydown", key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, timeStamp: 1000, getModifierState: () => false, preventDefault() {}, stopPropagation() {}, ...init };
  await act(async () => {
    for (const fn of [...(listeners.keydown ?? [])]) fn(e);
  });
}
const ctrlShiftK = { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true };

// ---- SET-008 ----
test("SET-008 box 1: the Unassigned filter lists exactly the commands that show no chord", async () => {
  const { c } = await page(file({ version: 1, keybindings: {} }));
  const everyone = ids(c);
  const noChord = everyone.filter((id) => chords(row(c, id)).length === 0);
  expect(noChord.length).toBeGreaterThan(10);
  expect(noChord).toContain("view.tasks");
  expect(noChord).not.toContain("terminal.clear");
  await pickFilter(c, "Unassigned");
  await settle();
  expect(ids(c)).toEqual(noChord);
  for (const id of ids(c)) expect(badges(row(c, id))).toEqual(["Unassigned"]);
});

test("SET-008 box 2: searching Mod+K, or Ctrl+K as it is drawn, shows the clear-terminal command", async () => {
  const { c } = await page(file({ version: 1, keybindings: {} }));
  expect(search(c).attrs.maxLength ?? search(c).attrs.maxlength).toBe("100"); // the capped search text
  for (const q of ["Mod+K", "Ctrl+K"]) {
    await typeInto(c, search(c), q);
    await settle();
    expect(ids(c), q).toContain("terminal.clear");
    expect(chords(row(c, "terminal.clear"))).toEqual(["Ctrl+K"]);
  }
  await typeInto(c, search(c), "Ctrl+Shift+K");
  await settle();
  expect(ids(c)).not.toContain("terminal.clear");
});

// ---- SET-009 ----
test("SET-009 box 1: recording Mod+Shift+K on a command shows it with a Modified badge and writes the entry", async () => {
  const { c, host } = await page(file({ version: 1, keybindings: {} }));
  expect(badges(row(c, "terminal.clear"))).toEqual([]);
  await click(c, find(row(c, "terminal.clear"), (n) => n.localName === "button" && text(n) === "Ctrl+K")[0]);
  expect(chords(row(c, "terminal.clear"))).toEqual(["Press keys..."]); // the recorder waits
  await press(ctrlShiftK);
  await until(() => chords(row(c, "terminal.clear"))[0] === "Ctrl+Shift+K");
  expect(badges(row(c, "terminal.clear"))).toEqual(["Modified"]);
  expect(host.writes).toEqual([{ id: "terminal.clear", value: "Mod+Shift+K", reset: false }]);
  expect(host.file.value.platforms.win32["terminal.clear"]).toBe("Mod+Shift+K");
});

test("SET-009 box 2: Esc while recording keeps the previous chord and writes nothing", async () => {
  const { c, host } = await page(file({ version: 1, keybindings: {} }));
  await click(c, button(row(c, "terminal.clear"), "Ctrl+K"));
  expect(chords(row(c, "terminal.clear"))).toEqual(["Press keys..."]);
  await press({ key: "Escape", code: "Escape" });
  await settle();
  expect(chords(row(c, "terminal.clear"))).toEqual(["Ctrl+K"]);
  expect(badges(row(c, "terminal.clear"))).toEqual([]);
  expect(host.writes).toEqual([]);
  expect(listeners.keydown ?? []).toHaveLength(0); // the recorder let go of the keyboard
});

test("SET-009 box 3: Reset brings the default chord back and the Modified badge goes away", async () => {
  const { c, host } = await page(file({ version: 1, keybindings: {}, platforms: { win32: { "terminal.clear": "Mod+Shift+K" } } }));
  expect(chords(row(c, "terminal.clear"))).toEqual(["Ctrl+Shift+K"]);
  expect(badges(row(c, "terminal.clear"))).toEqual(["Modified"]);
  await click(c, button(row(c, "terminal.clear"), "Reset"));
  await until(() => chords(row(c, "terminal.clear"))[0] === "Ctrl+K");
  expect(badges(row(c, "terminal.clear"))).toEqual([]);
  expect(button(row(c, "terminal.clear"), "Reset")).toBeUndefined();
  expect(host.writes).toEqual([{ id: "terminal.clear", value: "Mod+K", reset: true }]);
  expect(host.file.value.platforms.win32["terminal.clear"]).toBeUndefined();
});

// ---- SET-010 ----
test("SET-010 box 1: Mod+P bound to a second global command flags both rows Conflicts and lists them under Conflicting", async () => {
  const { c } = await page(file({ version: 1, keybindings: {} }));
  const holders = find(c, (n) => n.localName === "tr").filter((r) => chords(r).includes("Ctrl+P")).map((r) => r.attrs["data-id"]);
  expect(holders).toHaveLength(1); // the shipped holder of Mod+P (quick open)
  const second = "workspace.openBoard";
  await click(c, button(row(c, second), "Add"));
  await press({ key: "P", code: "KeyP", ctrlKey: true });
  await until(() => chords(row(c, second)).includes("Ctrl+P"));
  expect(badges(row(c, second))).toContain("Conflicts");
  expect(badges(row(c, holders[0]))).toContain("Conflicts");
  await pickFilter(c, "Conflicting");
  await settle();
  expect(ids(c).sort()).toEqual([second, holders[0]].sort());
});

// ---- SET-011 ----
test("SET-011 box 1: terminal.clear set to null in the keybindings map has no chord and sits under the Unassigned filter", async () => {
  const { c } = await page(file({ version: 1, keybindings: { "terminal.clear": null } }));
  expect(chords(row(c, "terminal.clear"))).toEqual([]);
  expect(text(row(c, "terminal.clear"))).toContain("None");
  expect(badges(row(c, "terminal.clear"))).toEqual(["Unassigned"]); // spec/17 SET-011 box 1: unbound reads Unassigned
  await pickFilter(c, "Unassigned");
  await settle();
  expect(ids(c)).toContain("terminal.clear");
});

test("SET-011 box 2: a file that cannot be read raises a diagnostic and the default chords work", async () => {
  const msg = "The shortcuts file could not be read (expected value at line 1); the default shortcuts are in use and the file was not changed.";
  const { c, keymap } = await page(file(null, msg));
  expect(text(c)).toContain(msg);
  expect(chords(row(c, "terminal.clear"))).toEqual(["Ctrl+K"]);
  const { matchEvent } = await import("../../keys/keymap");
  const hit = matchEvent(keymap(), { key: "k", code: "KeyK", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, ["global", "tabs", "terminal"]);
  expect(hit?.id).toBe("terminal.clear");
});

test("SET-011 box 3: a win32 section overriding a shared entry wins on Windows; other platforms' sections are ignored", async () => {
  const f = file({
    version: 1,
    keybindings: { "terminal.clear": "Mod+Shift+K", "terminal.splitRight": "Mod+Alt+R" },
    platforms: { win32: { "terminal.clear": "Mod+Alt+K" }, darwin: { "terminal.splitRight": "Mod+J" }, linux: { "terminal.splitRight": "Mod+L" } },
  });
  const { c } = await page(f);
  expect(chords(row(c, "terminal.clear"))).toEqual(["Ctrl+Alt+K"]); // the section, not the shared Mod+Shift+K
  expect(chords(row(c, "terminal.splitRight"))).toEqual(["Ctrl+Alt+R"]); // the shared entry where no section overrides
});

// ---- SET-013 ----
test("SET-013 box 1: on Windows Alt+1 selects tab 1, Ctrl+Shift+J opens the palette, Mod+Shift+D splits right", async () => {
  const { c, keymap } = await page(file({ version: 1, keybindings: {} }));
  expect(chords(row(c, "tab.selectByIndex"))[0]).toMatch(/^Alt\+1/);
  expect(chords(row(c, "worktree.palette"))).toEqual(["Ctrl+Shift+J", "Ctrl+Shift+P"]);
  expect(chords(row(c, "terminal.splitRight"))).toEqual(["Ctrl+Shift+D"]);
  const { matchEvent } = await import("../../keys/keymap");
  const ev = (key: string, code: string, o: Record<string, boolean>) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
  const scopes = ["global", "tabs", "terminal"] as never;
  expect(matchEvent(keymap(), ev("1", "Digit1", { altKey: true }), scopes)).toEqual({ id: "tab.selectByIndex", index: 1 });
  expect(matchEvent(keymap(), ev("J", "KeyJ", { ctrlKey: true, shiftKey: true }), scopes)?.id).toBe("worktree.palette");
  expect(matchEvent(keymap(), ev("D", "KeyD", { ctrlKey: true, shiftKey: true }), scopes)?.id).toBe("terminal.splitRight");
});

test("SET-013 box 2: the Unassigned filter lists the board, dashboard, tasks, inbox and floor views", async () => {
  const { c } = await page(file({ version: 1, keybindings: {} }));
  await pickFilter(c, "Unassigned");
  await settle();
  for (const id of ["workspace.openBoard", "dashboard.toggle", "view.tasks", "view.inbox", "view.floor"]) expect(ids(c), id).toContain(id);
});
