// APP-054 on the real ResourceManager (real grouping, formatting and End question) on the small DOM. The Rust
// measuring (resources.rs) and Terminals::kill are stood in at the invoke boundary and proven in cards_19.rs
// and by the in-module tests; the status-bar click that opens the popover is LIVE.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, until, withText } from "../../tasks/fakeDom";
import { formatMemory } from "../memory";

const MB = 1024 * 1024;
const back = vi.hoisted(() => ({
  running: [] as { id: number; pid: number; bytes: number }[],
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    back.calls.push({ cmd, args });
    if (cmd === "resources") {
      const sessions = back.running.map((s) => ({ id: s.id, pid: s.pid, dir: "G:\\Dev\\fakeproj", bytes: s.bytes, cpu: 1.5, processes: 2, committed: s.bytes * 2 }));
      return Promise.resolve({ app: { bytes: 300 * 1048576, cpu: 3, processes: 1, committed: null }, sessions, free: 8 * 1024 * 1048576, total: 16 * 1024 * 1048576 });
    }
    if (cmd === "terminal_kill") {
      back.running = back.running.filter((s) => s.id !== args.id);
      return Promise.resolve(null);
    }
    if (cmd === "session_tabs" || cmd === "terminal_host_sessions") return Promise.resolve([]);
    return Promise.resolve(null);
  },
}));

// The small DOM has no querySelectorAll; the dialog keys (chrome/dialogFocus.ts) are proved in dialogFocus.test.ts and resourceManagerUx.test.ts.
vi.mock("../../chrome/dialogFocus", () => ({ useDialogFocus: () => {} }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let root: FakeNode;
beforeEach(() => {
  doc = installDom().doc as FakeDocument;
  back.calls = [];
  back.running = [
    { id: 11, pid: 4101, bytes: 120 * MB },
    { id: 12, pid: 4102, bytes: 80 * MB },
    { id: 13, pid: 4103, bytes: 45 * MB },
  ];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const rows = (root: FakeNode) => find(root, (n) => n.attrs["data-session"] !== undefined);
const endButton = (row: FakeNode) => find(row, (n) => n.localName === "button" && n.textContent.trim() === "End")[0];
const open = async () => {
  const { default: ResourceManager } = await import("../ResourceManager");
  const m = await mount(createElement(ResourceManager, { names: () => ({ 11: "Build", 12: "Tests", 13: "Docs" }), workspaces: ["G:\\Dev\\fakeproj"], loaded: () => true, onClose: () => {} }), doc);
  unmount = m.unmount;
  root = m.container;
  await until(() => rows(doc.body).length > 0, "the session rows");
  return m;
};

test("box 1: three sessions running give three session rows, each with a memory figure", async () => {
  await open();
  const r = rows(doc.body);
  expect(r.map((n) => n.attrs["data-session"])).toEqual(["11", "12", "13"]);
  const figures = r.map((n) => find(n, (c) => (c.attrs.class ?? c.attrs.className) === "res-fig")[0].textContent);
  expect(figures).toEqual([formatMemory(120 * MB), formatMemory(80 * MB), formatMemory(45 * MB)]);
  for (const f of figures) expect(f).toMatch(/\d/);
  expect(find(doc.body, (n) => n.localName === "section" && n.attrs["aria-label"] === "fakeproj")).toHaveLength(1); // one worktree group holds them
});

test("box 2: confirming End on one session stops that one only; the other two keep running", async () => {
  await open();
  const row = rows(doc.body).find((n) => n.attrs["data-session"] === "12")!;
  await click(root, endButton(row));
  expect(back.calls.filter((c) => c.cmd === "terminal_kill")).toHaveLength(0); // asked first, nothing ended yet
  const asked = () => find(doc.body, (n) => n.attrs.role === "alertdialog" && n.attrs["aria-label"] === "End Tests");
  await until(() => asked().length === 1, "the End question");
  const ask = asked();
  await click(root, find(ask[0], (n) => n.localName === "button" && n.textContent.trim() === "End session")[0]);
  await until(() => rows(doc.body).length === 2, "the list to shrink");
  expect(back.calls.filter((c) => c.cmd === "terminal_kill").map((c) => c.args)).toEqual([{ id: 12 }]);
  expect(back.running.map((s) => s.id)).toEqual([11, 13]);
  expect(rows(doc.body).map((n) => n.attrs["data-session"])).toEqual(["11", "13"]);
});

test("box 2 (Keep): answering Keep ends nothing", async () => {
  await open();
  await click(root, endButton(rows(doc.body)[0]));
  await until(() => withText(doc.body, "button", "Keep").length === 1, "the End question");
  await click(root, withText(doc.body, "button", "Keep")[0]);
  await until(() => find(doc.body, (n) => n.attrs.role === "alertdialog").length === 0, "the question to close");
  expect(back.calls.filter((c) => c.cmd === "terminal_kill")).toHaveLength(0);
  expect(rows(doc.body)).toHaveLength(3);
});
