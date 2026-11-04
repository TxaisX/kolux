// W201 B2: the unsaved question opens over the workspace delete question, which stays mounted under it while
// the caller awaits the answer. The question must take the keyboard from that dialog: Tab stays inside it, the
// first Escape closes only it, and the delete question answers again once it is gone. The page is the small
// stand-in the other dialog tests use, with a window that keeps its capture listeners and focus that goes where
// focus() puts it, so the keys a keyboard user sends are the keys the test sends.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCloseGuard } from "../editor/CloseDialog";
import type { GuardPane } from "../editor/closeGuard";
import { FOCUSABLE } from "../chrome/dialogFocus";
import { type FakeDocument, FakeNode, byLabel, byText, click, find, installDom, mount, settle } from "../tasks/fakeDom";
import { sameDir } from "../workspaces";
import ProjectsPanel from "./ProjectsPanel";
import { namesOf, panesInDirs, unsavedInDirs } from "./wsUnsaved";

const h = vi.hoisted(() => ({ calls: [] as string[], settings: {} as Record<string, unknown>, scan: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    if (cmd === "get_settings") return Promise.resolve(h.settings);
    if (cmd === "cleanup_scan") return Promise.resolve(h.scan);
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], stamp: "s", commits: [] });
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] });
    if (cmd === "visibility_get") return Promise.resolve([]);
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: [main, ws], unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get" || cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const ws = { ...base, path: "C:/w/ws/fix", branch: "fix", head: "c3c3c3c", isMain: false };
const panes: GuardPane[] = [
  { key: 7, kind: "editor", path: "C:/w/ws/fix/a.ts", cwd: "C:/w/ws/fix" },
  { key: 8, kind: "editor", path: "C:/w/ws/fix/b.md", cwd: "C:/w/ws/fix" },
  { key: 9, cwd: "C:/w/ws/fix" },
];
const dirty = { 7: true, 8: false, 9: false };
const props = {
  openDirs: [], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
  activeDir: null, onSelect: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
  defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
  createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
};
let doc: FakeDocument;
let onWindow: Record<string, { fn: (e: unknown) => void; capture: boolean }[]>;
let unmount: () => Promise<void> = async () => {};

function Harness() {
  const guard = useCloseGuard({ panes, dirty, close: () => {}, toast: () => {} });
  return createElement(
    "div",
    null,
    guard.dialog,
    createElement(ProjectsPanel, {
      ...props,
      onRemoved: () => {},
      unsavedIn: (paths: string[]) => namesOf(unsavedInDirs(panes, dirty, paths, sameDir)),
      onAskUnsaved: (paths: string[]) => guard.confirm(panesInDirs(panes, paths, sameDir)),
    } as never),
  );
}

const realFocus = FakeNode.prototype.focus;
const realClosest = FakeNode.prototype.closest;
const realQuery = FakeNode.prototype.querySelectorAll;
/** Just enough of Element.matches for the trap's focusable list and the attribute selectors the dialogs ask. */
function matches(n: FakeNode, sel: string) {
  if (sel === FOCUSABLE)
    return n.nodeType === 1 && ((/^(button|input|select|textarea)$/.test(n.localName) && !("disabled" in n.attrs) && n.attrs.type !== "hidden") || (n.localName === "a" && "href" in n.attrs) || ("tabindex" in n.attrs && n.attrs.tabindex !== "-1"));
  return sel.split(",").some((one) => {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(one.trim());
    return !!m && n.nodeType === 1 && m[1] in n.attrs && (m[2] === undefined || n.attrs[m[1]] === m[2]);
  });
}

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  onWindow = {};
  Object.assign(dom.win, {
    addEventListener: (t: string, fn: (e: unknown) => void, o?: boolean | { capture?: boolean }) => (onWindow[t] ??= []).push({ fn, capture: typeof o === "object" ? !!o.capture : !!o }),
    removeEventListener: (t: string, fn: (e: unknown) => void) => (onWindow[t] = (onWindow[t] ?? []).filter((l) => l.fn !== fn)),
    setInterval, clearInterval, setTimeout, clearTimeout, dispatchEvent: () => true,
  });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  FakeNode.prototype.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  FakeNode.prototype.closest = function (this: FakeNode, sel: string) {
    for (let n: FakeNode | null = this; n; n = n.parentNode) if (matches(n, sel)) return n;
    return null;
  };
  FakeNode.prototype.querySelectorAll = function (this: FakeNode, sel: string) {
    return find(this, (n) => n !== this && matches(n, sel));
  };
  h.calls = [];
  h.settings = {};
  h.scan = { projectId: "p1", rows: [], error: null, timedOut: false, atMs: 1 };
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  FakeNode.prototype.focus = realFocus;
  FakeNode.prototype.closest = realClosest;
  FakeNode.prototype.querySelectorAll = realQuery;
});

/** A key pressed where the keyboard is, sent as a browser sends it: capture listeners from the window down to
 *  the target, then bubble listeners back up; a listener that stops it ends the trip there. */
async function press(key: string, shiftKey = false) {
  const target = doc.activeElement;
  const nodes: { listeners: Record<string, { fn: (e: unknown) => void; capture: boolean }[]> }[] = [{ listeners: onWindow }, doc];
  const up: FakeNode[] = [];
  for (let n: FakeNode | null = target; n; n = n.parentNode) up.unshift(n);
  nodes.push(...up);
  let stopped = false;
  let now = false;
  const ev = {
    type: "keydown",
    key,
    code: key,
    keyCode: key === "Escape" ? 27 : 0,
    which: key === "Escape" ? 27 : 0,
    target,
    srcElement: target,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    isTrusted: true,
    isComposing: false,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    shiftKey,
    metaKey: false,
    timeStamp: Date.now(),
    getModifierState: () => false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    stopImmediatePropagation() {
      stopped = now = true;
    },
  };
  const run = (n: { listeners: Record<string, { fn: (e: unknown) => void; capture: boolean }[]> }, capture: boolean) => {
    for (const l of [...(n.listeners.keydown ?? [])]) if (l.capture === capture && !now) l.fn(ev);
  };
  await act(async () => {
    const last = nodes.length - 1;
    for (let i = 0; i < last && !stopped; i++) run(nodes[i], true);
    if (!stopped) run(nodes[last], true); // at the target: its capture listeners, then its others
    if (!stopped) run(nodes[last], false);
    for (let i = last - 1; i >= 0 && !stopped; i--) run(nodes[i], false);
  });
}

const isDeleteX = (n: FakeNode) => n.localName === "button" && String(n.attrs.title ?? "").startsWith("Delete this workspace");
const delAsk = (c: FakeNode) => byLabel(c, "div", "Delete workspace")[0];
const guardAsk = (c: FakeNode) => byLabel(c, "div", "Save changes before closing?")[0];

test("Tab stays in the unsaved question and the first Escape closes only it; the delete dialog works again after", async () => {
  const m = await mount(createElement(Harness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  await click(c, find(c, isDeleteX)[0]);
  await settle(80);
  await click(c, byText(delAsk(c), "button", "Delete")[0]);
  await settle(80);
  const card = guardAsk(c);
  expect(card, "the question opened over the delete dialog").toBeDefined();
  expect(delAsk(c), "which stays mounted under it").toBeDefined();

  // Tab stays in the top dialog: from its last control it wraps to its first, instead of being pulled into the
  // delete dialog behind the scrim.
  byText(card, "button", "Save")[0].focus();
  await press("Tab");
  expect(doc.activeElement, "Tab from Save wraps to the question's Cancel").toBe(byText(card, "button", "Cancel")[0]);
  expect(card.contains(doc.activeElement), "focus never left the question").toBe(true);

  // The first Escape closes only the question. The delete dialog that asked it is still there, still pending.
  await press("Escape");
  expect(guardAsk(c), "the first Escape closed the question").toBeUndefined();
  expect(delAsk(c), "and left the delete dialog that asked it").toBeDefined();
  expect(h.calls).not.toContain("workspace_remove");

  // The browser drops the focus of the control that left; the lower dialog answers again now that it is top.
  doc.activeElement = doc.body;
  await press("Escape");
  expect(delAsk(c), "the next Escape closes the delete dialog").toBeUndefined();
  expect(h.calls).not.toContain("workspace_remove");
});
