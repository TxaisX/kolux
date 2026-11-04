// C10-R2-01: Ctrl+Enter commits only from the commit message box. The panel's key handler used to
// sit on its root, so the shortcut fired from every text box in the panel: a handoff note, a pull
// request description. A key pressed in any of those is that field's own, and writes no commit.
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, click, find, fire, installDom, mount, settle, typeInto } from "../tasks/fakeDom";
import type { Status } from "./model";
import panelSrc from "./SourceControlPanel.tsx?raw";
import prStartSrc from "./PrStart.tsx?raw";
import checksSrc from "./ChecksPanel.tsx?raw";

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  status: null as unknown,
  onStatus: null as ((s: unknown) => void) | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    if (cmd === "scm_status") return Promise.resolve(h.status);
    if (cmd === "scm_commit") return Promise.resolve({ id: "abc1234", blocked: false, output: "" });
    if (cmd === "scm_pr") return Promise.resolve({ pr: null, provider: "github", host: "github.com" });
    if (cmd === "agent_list" || cmd === "worktree_branches") return Promise.resolve([]);
    if (cmd === "workspace_note_get") return Promise.resolve({ text: "", updated: null });
    if (cmd === "get_settings") return Promise.resolve({});
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));
vi.mock("./watch", () => ({
  watchStatus: (_dir: string, on: (s: unknown) => void) => {
    h.onStatus = on;
    return () => {};
  },
}));

const A = "C:/w/ws/a";
// The panel pulls in the whole Source Control surface on its first mount, slow on a loaded machine.
vi.setConfig({ testTimeout: 20_000 });
const staged: Status = { branch: "feat", upstream: "origin/feat", ahead: 0, behind: 0, rewritten: false, base: "origin/main", head: "c3c3c3c", staged: [{ path: "a.ts", status: "M", from: null }], changed: [], untracked: [], conflicts: [], operation: null, resolved: [] };
const clean: Status = { ...staged, staged: [] };

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800 });
  h.calls = [];
  h.onStatus = null;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel(status: Status) {
  h.status = status;
  const { default: SourceControlPanel } = await import("./SourceControlPanel");
  const props = {
    initialStatus: status,
    onClose: () => {},
    onFix: () => {},
    pinnedBase: null,
    againstUpstream: false,
    onAgainstUpstream: () => {},
    agents: [],
    onHand: () => {},
    fixAgent: null,
    onFixAgent: () => {},
    onAgentAction: async () => null,
    linkedPr: null,
    onLinkPr: () => {},
  };
  // The draft message is the window's, as in App: the box is controlled by the host.
  const Host = () => {
    const [draft, setDraft] = useState("");
    return createElement(SourceControlPanel, { ...props, dir: A, draft, onDraft: (t: string) => setDraft(t) } as never);
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await settle(80);
  return m.container as FakeNode;
}

const commits = () => h.calls.filter((x) => x.cmd === "scm_commit").map((x) => x.args);
const field = (c: FakeNode, label: string) => find(c, (n) => n.attrs["aria-label"] === label)[0];
/** The message box by its placeholder, so this test finds it whether or not it also has a name. */
const messageField = (c: FakeNode) => find(c, (n) => n.localName === "textarea" && String(n.attrs.placeholder ?? "").startsWith("Message (Ctrl+Enter to commit"))[0];
const press = (c: FakeNode, target: FakeNode, extra: Record<string, unknown> = {}) => fire(c, "keydown", target, { key: "Enter", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra });

test("Ctrl+Enter in the handoff note commits nothing, and the typed message waits", async () => {
  const c = await panel(staged);
  const message = messageField(c);
  await typeInto(c, message, "Add the thing");
  const note = field(c, "handoff note");
  expect(note, "the handoff note is in the panel").toBeTruthy();
  await typeInto(c, note, "Handing this to the next agent");
  await press(c, note);
  await settle(40);
  expect(commits(), "a note is not a commit").toEqual([]);
  expect(message.value, "the commit message is still there").toBe("Add the thing");
});

test("Ctrl+Enter in the pull request description commits nothing staged while it is open", async () => {
  const c = await panel(clean);
  const remote = find(c, (n) => n.localName === "button" && n.attrs.title === "Remote actions")[0];
  remote.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 20, width: 200, height: 20, x: 0, y: 0 });
  await click(c, remote);
  await settle(20);
  const item = find(c, (n) => n.attrs["data-action"] === "pr")[0];
  expect(item, "the remote menu offers Create pull request").toBeTruthy();
  await click(c, item);
  await settle(20);
  const description = field(c, "pull request description");
  expect(description, "the composer is up").toBeTruthy();
  await typeInto(c, messageField(c), "Add the thing");
  // Staged work arrives through the git watcher while the composer is open.
  await act(async () => h.onStatus?.(staged));
  await settle(40);
  await typeInto(c, description, "What this branch does");
  await press(c, description);
  await settle(40);
  expect(commits(), "a pull request description is not a commit").toEqual([]);
});

test("Ctrl+Enter in the commit message still commits, once, with what was typed", async () => {
  const c = await panel(staged);
  await typeInto(c, messageField(c), "Add the thing");
  await press(c, messageField(c));
  await settle(60);
  expect(commits()).toEqual([{ worktree: A, message: "Add the thing" }]);
  expect(c.textContent).toContain("Committed abc1234");
});

test("a keystroke still part of an input-method composition commits nothing", async () => {
  const c = await panel(staged);
  await typeInto(c, messageField(c), "Add the thing");
  await press(c, messageField(c), { isComposing: true });
  await settle(40);
  expect(commits()).toEqual([]);
});

test("no panel-wide handler holds the shortcut, and the pull request composer has none at all", () => {
  const at = panelSrc.indexOf("<aside");
  const aside = panelSrc.slice(at, panelSrc.indexOf(">", at));
  expect(aside, "the panel root only clears the selection").not.toContain("isCommitShortcut");
  expect(panelSrc, "the message box is the one field that carries it").toContain('aria-label="Commit message"');
  for (const src of [prStartSrc, checksSrc]) {
    expect(src).not.toContain("isCommitShortcut");
    expect(src).not.toContain("scm_commit");
  }
});

