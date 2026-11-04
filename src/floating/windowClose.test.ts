// VIEW-107 (P0): a floating note is a file tab of its own, and the window did not know it held
// unsaved text, so quitting or Force Reloading threw the text away with no question. The layer
// reports its unsaved notes and the window names them in the close question: Cancel keeps the app
// open and the note on screen, the same as it does for a pane.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, byText, click, fire, installDom, mount, settle, until } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({
  close: null as null | ((e: { preventDefault(): void }) => unknown),
  prevented: 0,
  dirty: true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "md_new") return Promise.resolve("C:/notes/todo.md");
    if (cmd === "tray_close_requested") return Promise.resolve({ hid: false, quitting: false });
    if (cmd === "terminal_busy") return Promise.resolve([]);
    return Promise.resolve({});
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (fn: (e: { preventDefault(): void }) => unknown) => {
      h.close = fn;
      return Promise.resolve(() => {});
    },
    close: () => Promise.resolve(),
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
// The note's editor is CodeMirror, which is not what this test is about: the stub reports the text
// as typed in, the way the real one does when its buffer turns unsaved.
vi.mock("../lazy/panes", async () => {
  const { useEffect } = await import("react");
  return {
    EditorPane: ({ onDirty }: { onDirty?: (d: boolean) => void }) => {
      useEffect(() => void (h.dirty && onDirty?.(true)), []); // once, as the real editor does when its buffer turns unsaved
      return null;
    },
    BrowserPane: () => null,
  };
});
vi.mock("../terminal/TerminalPane", () => ({ default: () => null }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let win: ReturnType<typeof import("../shell/useWindowSave").useWindowSave> | null = null;

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { innerWidth: 1280, innerHeight: 800, setInterval, clearInterval, setTimeout, clearTimeout });
  h.close = null;
  h.prevented = 0;
  h.dirty = true;
  win = null;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

/** The window's own save hook, over the real floating layer, as App and Hosts mount them. */
async function app() {
  const { useWindowSave } = await import("../shell/useWindowSave");
  const { default: FloatingLayer } = await import("./FloatingLayer");
  const props = {
    activeDir: null, activeTab: {}, classic: false, dirty: {}, focused: 0, page: null, panes: [], pinned: new Set<number>(), read: false,
    running: {}, saveSetting: () => {}, screen: "terminals", setHist: () => {}, setNotice: () => {}, setPanes: () => {}, setScreen: () => {},
    setSettings: () => {}, settings: {}, settingsRead: false, settingsRef: { current: {} }, stacked: {}, tabColors: {},
  } as unknown as Parameters<typeof useWindowSave>[0];
  const Host = () => {
    win = useWindowSave(props);
    return createElement("div", null, createElement(FloatingLayer, { home: "C:/notes" }));
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await until(() => h.close !== null, "the window's close listener");
  return m.container as FakeNode;
}

/** The floating panel: open it with its own button, then add a note there and wait for its text to be typed in. */
async function dirtyNote(c: FakeNode) {
  await fire(c, "keydown", byLabel(c, "button", "Floating workspace panel")[0], { key: "Enter" });
  await settle(20);
  await click(c, byText(c, "button", "New note")[0]);
  await until(() => byLabel(c, "button", "Close todo.md").length === 1, "the new note's tab");
  await settle(20);
}

const closes = () => win?.quitAsk ?? null;

test("VIEW-107: a close request with an unsaved floating note asks first, naming the note", { timeout: 30000 }, async () => {
  const c = await app();
  await dirtyNote(c);
  await h.close!({ preventDefault: () => void h.prevented++ });
  await settle(20);
  expect(h.prevented).toBe(1);
  const ask = closes();
  expect(ask).toEqual({ files: ["todo.md"], agents: [] });
  const { quitQuestion } = await import("../shell/closeAsk");
  expect(quitQuestion(ask!).body).toContain("1 file has unsaved changes: todo.md. Quitting now loses them.");
  expect(quitQuestion(ask!).title).toBe("Quit with unsaved changes?");
});

test("VIEW-107: Force Reload asks over the note too, and reloads only on yes", { timeout: 30000 }, async () => {
  const c = await app();
  await dirtyNote(c);

  // The list Force Reload reads is the window's own, so a note typed into is named there as well.
  const { forceReload } = await import("../keys/commands");
  const asked: string[][] = [];
  let reloads = 0;
  expect(forceReload(win!.unsaved.current, (files) => asked.push(files), () => void reloads++)).toBe(false);
  expect(asked).toEqual([["todo.md"]]);
  expect(reloads).toBe(0);
});

test("VIEW-107: Cancel keeps the app open and the note, with its text, still there", { timeout: 30000 }, async () => {
  const c = await app();
  await dirtyNote(c);
  await h.close!({ preventDefault: () => void h.prevented++ });
  await settle(20);
  expect(h.prevented).toBe(1); // the window did not go on to close
  expect(closes()).not.toBeNull();
  await (await import("react")).act(async () => win!.setQuitAsk(null));
  expect(closes()).toBeNull();
  expect(byLabel(c, "button", "Close todo.md").length).toBe(1); // the note was not closed or thrown away
});

test("VIEW-107: a note with nothing typed in asks nothing, as before", { timeout: 30000 }, async () => {
  h.dirty = false; // the note opens and stays clean
  const c = await app();
  await fire(c, "keydown", byLabel(c, "button", "Floating workspace panel")[0], { key: "Enter" });
  await settle(20);
  await click(c, byText(c, "button", "New note")[0]);
  await until(() => byLabel(c, "button", "Close todo.md").length === 1, "the new note's tab");
  await settle(20);
  await h.close!({ preventDefault: () => void h.prevented++ });
  await settle(20);
  expect(h.prevented).toBe(0);
  expect(closes()).toBeNull();
});


