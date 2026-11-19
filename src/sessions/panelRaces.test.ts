// Audit F17, F18, F20 on the real Agents panel (small DOM, backend mocked): a slow Resume opens one pane, a
// rescan asked for too soon runs once later instead of never, and an old scope's read error does not stay
// under a new scope.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, installDom, mount, settle } from "../test/fakeDom";
import rightSrc from "../shell/window/Right.tsx?raw";

type Call = { cmd: string; args: Record<string, unknown>; ok: (v: unknown) => void; fail: (e: unknown) => void };
const h = vi.hoisted(() => ({ calls: [] as Call[], hold: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) =>
    new Promise((ok, fail) => {
      h.calls.push({ cmd, args, ok, fail });
      if (cmd === "session_resume_plan") ok({ line: "claude --resume s1", copy: "claude --resume s1", cwd: "C:/w/a" });
      else if (cmd === "sessions_list" && !h.hold) ok([{ agent: "claude", id: "s1", title: "Fix login", modifiedMs: Date.now(), bytes: 10, turns: 2, dir: "C:/w/a" }]);
      else if (cmd !== "sessions_list") ok(null);
    }),
}));
// Short intervals so the test runs in well under a second; the panel's logic is the same.
vi.mock("./refresh", async (orig) => {
  const real = await orig<typeof import("./refresh")>();
  return { ...real, AFTER_START_MS: 40, RescanLimiter: class extends real.RescanLimiter { constructor() { super(300); } } };
});

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let set: (p: Partial<{ rescanKey: number; activeDir: string }>) => Promise<void> = async () => {};
let resumes = 0;
let finishResume: () => void = () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, addEventListener: () => {}, removeEventListener: () => {} });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.calls = [];
  h.hold = false;
  resumes = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: AgentsPanel } = await import("./AgentsPanel");
  const { act } = await import("react");
  const Host = () => {
    const [p, setP] = useState({ rescanKey: 0, activeDir: "C:/w/a" });
    set = async (next) => {
      await act(async () => setP((v) => ({ ...v, ...next })));
    };
    return createElement(AgentsPanel, {
      settings: {}, onSave: () => {}, projectDirs: [], projects: [{ path: "C:/w" }], visible: true, shell: null, ...p,
      // The slow part (reading the session's first prompt, trusting the folder) answers when the test says so.
      onResume: () => (resumes++, new Promise<void>((done) => (finishResume = done))),
    } as never);
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await settle(30);
  return m.container as FakeNode;
}
const lists = () => h.calls.filter((c) => c.cmd === "sessions_list");

test("F17: a second click on Resume while the slow part still runs opens no second pane", async () => {
  const c = await panel();
  const resume = () => click(c, byText(c, "button", "Resume")[0]);
  await resume();
  await settle(30);
  expect(resumes).toBe(1);
  await settle(800); // past the 0.7 s settle time, the first pane is still being set up
  await resume();
  await settle(30);
  expect(resumes, "the second click waited for the first").toBe(1);
  finishResume();
  await settle(800);
  await resume();
  await settle(30);
  expect(resumes, "once the first is open, Resume works again").toBe(2);
  finishResume();
});

test("F17: the window hands the panel the slow part's promise instead of dropping it", () => {
  // `void resumeOrFocus(...)` let the guard go 0.7 s after the plan came back, while the pane was still being set up.
  expect(rightSrc).toContain("onResume={(s, plan) => resumeOrFocus(s, plan)}");
  expect(rightSrc).not.toContain("void resumeOrFocus(");
});

test("F18: a rescan asked for inside the interval runs once at its end, not never", async () => {
  await panel();
  const before = lists().length;
  await set({ rescanKey: 1 });
  await settle(80);
  expect(lists().length).toBe(before + 1);
  await set({ rescanKey: 2 }); // a second agent starts soon after the first
  await settle(80);
  expect(lists().length, "not before the interval is over").toBe(before + 1);
  await set({ rescanKey: 3 }); // and a third: both share the one later rescan
  await settle(400);
  expect(lists().length).toBe(before + 2);
});

test("F20: an old scope's read error does not stay under a new scope", async () => {
  h.hold = true;
  const c = await panel();
  lists()[0].fail("disk busy");
  await settle(30);
  expect(c.textContent).toContain("Past sessions could not be read: disk busy");
  await set({ activeDir: "C:/w/b" });
  await settle(30);
  expect(c.textContent, "a new scope starts clean").not.toContain("could not be read");
  // A late failure for the old scope does not show under the new one either.
  await set({ activeDir: "C:/w/a" });
  await settle(10);
  const oldAsk = lists()[lists().length - 1];
  await set({ activeDir: "C:/w/b" });
  oldAsk.fail("late");
  await settle(30);
  expect(c.textContent).not.toContain("could not be read");
});
