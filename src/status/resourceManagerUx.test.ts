// UX audit findings/usage-status.md rows 2, 8, 11, 14 and 19 on the real ResourceManager (small DOM, tauri commands stood in).
// The chrome's dialog helper is stood in too, so the test can press "Escape" the way it does: by calling the onClose it was given.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, find, installDom, mount, settle, until, withText, type FakeDocument, type FakeNode } from "../tasks/fakeDom";
import { escapeStep, singleFlight } from "./resources";
import rmSource from "./ResourceManager.tsx?raw";

const back = vi.hoisted(() => ({
  running: [] as { id: number; pid: number }[],
  killFails: new Set<number>(),
  killHold: null as null | Promise<void>,
  kills: [] as number[],
  focus: { close: null as null | (() => void), calls: 0 },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "resources") {
      const sessions = back.running.map((s) => ({ id: s.id, pid: s.pid, dir: "G:\\Dev\\fakeproj", bytes: 10 * 1048576, cpu: 1.5, processes: 1, committed: 20 * 1048576 }));
      return Promise.resolve({ app: { bytes: 300 * 1048576, cpu: 3, processes: 1, committed: null }, sessions, free: 8 * 1024 * 1048576, total: 16 * 1024 * 1048576 });
    }
    if (cmd === "terminal_kill") {
      const id = args.id as number;
      back.kills.push(id);
      if (back.killFails.has(id)) return Promise.reject("boom: access denied");
      return (back.killHold ?? Promise.resolve()).then(() => {
        back.running = back.running.filter((s) => s.id !== id);
        return null;
      });
    }
    if (cmd === "session_tabs" || cmd === "terminal_host_sessions") return Promise.resolve([]);
    return Promise.resolve(null);
  },
}));
vi.mock("../chrome/dialogFocus", () => ({
  useDialogFocus: (_box: unknown, onClose: () => void) => {
    back.focus.close = onClose;
    back.focus.calls++;
  },
}));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let root: FakeNode;
let closed = 0;
beforeEach(() => {
  doc = installDom().doc as FakeDocument;
  back.running = [
    { id: 11, pid: 4101 },
    { id: 12, pid: 4102 },
  ];
  back.killFails = new Set();
  back.killHold = null;
  back.kills = [];
  back.focus = { close: null, calls: 0 };
  closed = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const rows = () => find(doc.body, (n) => n.attrs["data-session"] !== undefined);
const row = (id: number) => rows().find((n) => n.attrs["data-session"] === String(id))!;
const endButton = (id: number) => find(row(id), (n) => n.localName === "button" && n.textContent.trim() === "End")[0];
const open = async () => {
  const { default: ResourceManager } = await import("./ResourceManager");
  const m = await mount(createElement(ResourceManager, { names: () => ({ 11: "Build", 12: "Tests" }), workspaces: ["G:\\Dev\\fakeproj"], loaded: () => true, onClose: () => void closed++ }), doc);
  unmount = m.unmount;
  root = m.container;
  await until(() => rows().length === 2, "the session rows");
};
const questions = () => find(doc.body, (n) => n.attrs.role === "alertdialog");

test("usage-status.md:2: a failed End keeps its error through the next read until the user dismisses it", async () => {
  back.killFails.add(12);
  await open();
  await click(root, endButton(12));
  await until(() => questions().length === 1, "the End question");
  await click(root, withText(questions()[0], "button", "End session")[0]);
  await until(() => withText(doc.body, "span", "boom: access denied").length > 0, "the failed End's error");
  // Another End click makes a fresh read (and the 2 s poll makes one too); that read used to wipe the message.
  await click(root, endButton(11));
  await until(() => questions().length === 1, "the second End question");
  await settle();
  expect(withText(doc.body, "span", "boom: access denied")).toHaveLength(1);
  await click(root, withText(doc.body, "button", "Dismiss")[0]);
  expect(withText(doc.body, "span", "boom: access denied")).toHaveLength(0);
});

test("usage-status.md:14: each row's End button is named for its session", async () => {
  await open();
  expect(endButton(11).attrs["aria-label"]).toBe("End Build");
  expect(endButton(12).attrs["aria-label"]).toBe("End Tests");
});

test("usage-status.md:19: End all and Restart terminals are disabled while an End all run is going", async () => {
  let release = () => {};
  back.killHold = new Promise<void>((r) => (release = r));
  await open();
  const offer = () => find(doc.body, (n) => n.attrs["data-bulk"] === "offer")[0];
  const buttons = () => find(offer(), (n) => n.localName === "button");
  expect(buttons().map((b) => "disabled" in b.attrs)).toEqual([false, false]);
  await click(root, buttons()[0]);
  await until(() => find(doc.body, (n) => n.attrs["data-bulk"] === "ask").length === 1, "the End all question");
  await click(root, find(find(doc.body, (n) => n.attrs["data-bulk"] === "ask")[0], (n) => n.localName === "button" && n.textContent.trim() === "End all")[0]);
  await until(() => back.kills.length > 0 && find(doc.body, (n) => n.attrs["data-bulk"] === "offer").length === 1, "the run to start");
  expect(buttons().map((b) => "disabled" in b.attrs)).toEqual([true, true]);
  await act(async () => release());
  await until(() => find(doc.body, (n) => n.attrs["data-bulk"] === "offer").length === 0 || buttons().every((b) => !("disabled" in b.attrs)), "the run to end");
});

test("usage-status.md:8: the popup asks for the dialog keys, and Escape closes an open End question before the panel", async () => {
  await open();
  expect(back.focus.calls).toBeGreaterThan(0);
  await click(root, endButton(12));
  await until(() => questions().length === 1, "the End question");
  await act(async () => back.focus.close!());
  expect(questions()).toHaveLength(0);
  expect(closed).toBe(0);
  await act(async () => back.focus.close!());
  expect(closed).toBe(1);
});

test("usage-status.md:8: escapeStep picks the open question first, in the order bulk, single, End N", () => {
  expect(escapeStep({ bulk: false, ending: false, asking: false })).toBe("close");
  expect(escapeStep({ bulk: false, ending: true, asking: false })).toBe("ending");
  expect(escapeStep({ bulk: false, ending: false, asking: true })).toBe("asking");
  expect(escapeStep({ bulk: true, ending: true, asking: true })).toBe("bulk");
});

test("usage-status.md:11: a read that is still running makes the next tick do nothing", async () => {
  let finish = () => {};
  let started = 0;
  const tick = singleFlight(() => {
    started++;
    return new Promise<number>((r) => (finish = () => r(started)));
  });
  const first = tick();
  expect(await tick()).toBeUndefined(); // skipped while the first is running
  expect(started).toBe(1);
  finish();
  expect(await first).toBe(1);
  const again = tick(); // free again
  expect(started).toBe(2);
  finish();
  await again;
});

test("usage-status.md:11: the poll runs through singleFlight and the old window Escape listener is gone", () => {
  const src = rmSource;
  expect(src).toContain("singleFlight(refresh)");
  expect(src).not.toMatch(/setInterval\(\(\) => void refresh\(\)/);
  expect(src).not.toContain('window.addEventListener("keydown"');
});

test("usage-status.md:8: the popup itself takes focus on open, before its buttons are drawn, without becoming a Tab stop", () => {
  expect(rmSource).toMatch(/className="menu res-pop" role="dialog" aria-label="Resource Manager" tabIndex={-1}/);
  expect(rmSource).toContain("}, () => box.current);");
});
