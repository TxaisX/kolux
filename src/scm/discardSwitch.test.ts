// @vitest-environment happy-dom
// T-615 (F04-projects-scm.3): "Discard N changes?" only ever discards in the workspace it was asked in.
// The real Source Control panel on the small DOM, backend mocked: three rows are picked in workspace A
// and the bulk question opens; the panel then switches to workspace B (a shortcut, or an agent's
// file-open, can do that while the question is up). Nothing may be discarded in B.
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, fire, installDom, mount, settle } from "../tasks/realDom";
import type { Status } from "./model";

const h = vi.hoisted(() => ({ calls: [] as { cmd: string; args: Record<string, unknown> }[], status: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    if (cmd === "scm_status") return Promise.resolve(h.status);
    if (cmd === "get_settings") return Promise.resolve({});
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const A = "C:/w/ws/a";
const B = "C:/w/ws/b";
const edited = (path: string) => ({ path, status: "M", from: null });
const status: Status = { branch: "fix", upstream: null, ahead: 0, behind: 0, rewritten: false, base: null, head: "c3c3c3c", staged: [], changed: [edited("a.ts"), edited("b.ts"), edited("c.ts")], untracked: [], conflicts: [], operation: null, resolved: [] };

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let showDir: (dir: string) => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800 });
  h.calls = [];
  h.status = status;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: SourceControlPanel } = await import("./SourceControlPanel");
  const props = { initialStatus: status, draft: "", onDraft: () => {}, onClose: () => {}, onFix: () => {}, pinnedBase: null, againstUpstream: false, onAgainstUpstream: () => {}, agents: [], onHand: () => {}, fixAgent: null, onFixAgent: () => {}, onAgentAction: async () => null, linkedPr: null, onLinkPr: () => {} };
  // the window hands the panel the workspace in front; showDir switches it the way App does
  const Host = () => {
    const [dir, setDir] = useState(A);
    showDir = async (d) => {
      await act(async () => setDir(d));
      await settle(40);
    };
    return createElement(SourceControlPanel, { ...props, dir } as never);
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await settle(80);
  return m.container as FakeNode;
}
const row = (c: FakeNode, path: string) => find(c, (n) => n.localName === "div" && String(n.attrs.className ?? n.attrs.class ?? "") === "scm-row" && n.attrs.title === path)[0];
const discards = () => h.calls.filter((x) => x.cmd === "scm_discard").map((x) => x.args);
const question = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog");

async function askToDiscardThree(c: FakeNode) {
  await click(c, row(c, "a.ts"));
  await fire(c, "click", row(c, "b.ts"), { ctrlKey: true });
  await fire(c, "click", row(c, "c.ts"), { ctrlKey: true });
  await click(c, byText(c, "button", "Discard 3")[0]);
  await settle(20);
  expect(question(c).length, "the bulk question is up").toBe(1);
}

test("asked in A, confirmed in A: A's three files are discarded", async () => {
  const c = await panel();
  await askToDiscardThree(c);
  await click(c, byText(question(c)[0], "button", "Discard")[0]);
  await settle(40);
  expect(discards()).toEqual([{ worktree: A, paths: ["a.ts", "b.ts", "c.ts"] }]);
});

test("asked in A, then the panel switches to B: the question goes and nothing in B is discarded", async () => {
  const c = await panel();
  await askToDiscardThree(c);
  await showDir(B);
  const stillUp = question(c).length;
  if (stillUp > 0) await click(c, byText(question(c)[0], "button", "Discard")[0]); // a confirm that still shows must not reach B
  await settle(40);
  expect(discards(), "nothing is discarded in the workspace now shown").toEqual([]);
  expect(stillUp, "the question from A does not stay up over B").toBe(0);
});
