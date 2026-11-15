// Audit F3: a notebook cell sends its text to the file buffer 300 ms after the last key. Text typed just before the
// cells view goes away (a tab switch hides it and every cell unmounts) must still reach the buffer.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { find, installDom, mount, typeInto, type FakeDocument } from "../tasks/fakeDom";

const NB = JSON.stringify({ cells: [{ cell_type: "code", source: "x = 1", metadata: {}, outputs: [], execution_count: null }], metadata: {}, nbformat: 4, nbformat_minor: 5 });
vi.mock("./buffers", () => ({ textOf: () => NB, subscribe: () => () => {} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));

let doc: FakeDocument;
beforeEach(() => {
  vi.useFakeTimers();
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setTimeout, clearTimeout });
});
afterEach(() => vi.useRealTimers());

test("text typed in a cell reaches the buffer when the view unmounts before the 300 ms pause", async () => {
  const { default: NotebookView } = await import("./NotebookView");
  const sent: string[] = [];
  const { container, unmount } = await mount(createElement(NotebookView, { path: "C:/w/a.ipynb", loaded: 1, onText: (t: string) => sent.push(t) }), doc);
  const box = find(container, (n) => n.localName === "textarea")[0];
  await typeInto(container, box, "x = 12");
  expect(sent).toEqual([]); // still inside the 300 ms pause
  await unmount();
  expect(sent.length).toBe(1);
  expect(JSON.parse(sent[0]).cells[0].source).toContain("x = 12");
});

// Audit F3, save part: Ctrl+S runs from the window's key listener before the cell sees the key, so the editor's
// save first asks the cells of that notebook to send what they hold.
test("Save sends a cell's pending text first, so a save inside the 300 ms pause has the last keys", async () => {
  const { default: NotebookView, flushCells } = await import("./NotebookView");
  const sent: string[] = [];
  const { container, unmount } = await mount(createElement(NotebookView, { path: "C:/w/a.ipynb", loaded: 1, onText: (t: string) => sent.push(t) }), doc);
  const box = find(container, (n) => n.localName === "textarea")[0];
  await typeInto(container, box, "x = 34");
  flushCells("C:/w/other.ipynb");
  expect(sent).toEqual([]); // another notebook's save sends nothing from this one
  flushCells("C:/w/a.ipynb");
  expect(sent.length).toBe(1);
  expect(JSON.parse(sent[0]).cells[0].source).toContain("x = 34");
  vi.advanceTimersByTime(400);
  await unmount();
  expect(sent.length).toBe(1); // sent once: neither the pause nor the unmount sends it again
});

test("the editor's save runs the cell flush before it writes", async () => {
  const src = (await import("./EditorPane.tsx?raw")).default;
  expect(src).toContain("editors.set(id, () => (flushCells(path), needsName(path, root, diskOf(path)) ?");
});
