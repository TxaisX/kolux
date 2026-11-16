// VIEW-051 acceptance: the real ProjectsPanel on the small DOM, fed the window's panes as the `sessions` prop.
// MIRROR src/App.tsx (the `sessions` prop built from the window's panes); the row decisions are ProjectsPanel's (DT-C274: rows no longer carry a running-agent count) (T-640: terminal rows are gone from the left pane; they stay tabs in the main area).
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, installDom, mount, settle } from "../../tasks/fakeDom";

const h = vi.hoisted(() => ({ wt: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: h.wt, unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get" || cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    if (cmd === "scm_pushed") return Promise.resolve([{ path: "C:/w/app", state: "synced", count: 0 }]); // the green "synced" text of the folder row
    if (cmd === "skills_scan") return Promise.resolve({ skills: [] }); // the sidebar checklist reads it
    if (cmd === "workspace_statuses") return Promise.resolve({ list: [] }); // the worktree menu reads its status list
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

type Session = { key: number; agent: string; title: string; cwd: string | null; view?: string | null; running: boolean; state?: string };
const wt = { path: "C:/w/app", branch: "main", head: "abc1234", isMain: true, hidden: false, number: null, comment: "" };
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout }); // the small DOM has no timers on window
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.wt = [wt];
  selected.length = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const selected: string[] = [];
async function panel(sessions: Session[], settings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const { default: ProjectsPanel } = await import("../ProjectsPanel");
  const props = {
    openDirs: ["C:/w/app"], sessions, states: {}, unread: new Set<string>(), onUnread: () => {}, settings, onSetting: () => {},
    activeDir: "C:/w/app", onSelect: (dir: string) => void selected.push(dir), onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, deleteRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {}, ...extra,
  };
  const m = await mount(createElement(ProjectsPanel, props as never), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const paneRows = (c: FakeNode) => find(c, (n) => n.attrs["data-pane"] !== undefined);
const counts = (c: FakeNode) => find(c, (n) => String(n.attrs.className ?? n.attrs.class ?? "").split(" ").includes("count")).map((n) => n.textContent.trim());

// DT-C274 (Txais: "We only want the green text ... You don't have to tell me how many things are working inside
// that tree"): the rows no longer show a running-agent count, so running panes give neither rows nor a count.
test("box 1: running Cursor and Gemini panes are not listed as rows in the left pane, and no count shows", async () => {
  const c = await panel([
    { key: 1, agent: "cursor", title: "Fix the login", cwd: "C:/w/app", running: true },
    { key: 2, agent: "gemini", title: "Write the docs", cwd: "C:/w/app", running: true },
  ]);
  expect(paneRows(c)).toEqual([]);
  expect(counts(c)).toEqual([]);
});

test("box 2: running or stopped, a worktree's row shows no agent count (DT-C274)", async () => {
  const two: Session[] = [
    { key: 1, agent: "claude", title: "a", cwd: "C:/w/app", running: true },
    { key: 2, agent: "codex", title: "b", cwd: "C:/w/app", running: true },
  ];
  const before = await panel(two);
  expect(counts(before)).toEqual([]);
  await unmount();
  const none = await panel([{ ...two[0], running: false }, { ...two[1], running: false }]);
  expect(paneRows(none)).toEqual([]);
  expect(counts(none)).toEqual([]);
});

// Txais (2026-11-12): the sidebar lists workspace folders and their UI sessions, never worktrees. A team started with
// "Own folder for each AI" runs each agent in a worktree of its own; those agents are session rows under the folder.
const agentWt = (n: number) => ({ path: `C:/w/ws/agent${n}`, branch: `agent${n}`, head: `c${n}c${n}c${n}c`, isMain: false, hidden: false, number: null, comment: "" });
const handMade = { ...agentWt(9), path: "C:/w/ws/by-hand", branch: "by-hand" };
const six: Session[] = [1, 2, 3].flatMap((n) => [
  { key: n * 10, agent: "claude", title: `Claude ${n}`, cwd: `C:/w/ws/agent${n}`, view: "C:/w/app", running: true, state: "working" },
  { key: n * 10 + 1, agent: "codex", title: `Codex ${n}`, cwd: `C:/w/ws/agent${n}`, view: "C:/w/app", running: true, state: "idle" },
]);
const cls = (n: FakeNode) => String(n.attrs.className ?? n.attrs.class ?? "").split(" ");
/** The nodes the user can see: everything outside a subtree marked old-workspaces (display: none). */
function visible(n: FakeNode, out: FakeNode[] = []): FakeNode[] {
  if (cls(n).includes("old-workspaces")) return out;
  out.push(n);
  for (const k of n.childNodes) visible(k, out);
  return out;
}
const team = { teamWorktrees: [1, 2, 3].map((n) => ({ path: `C:/w/ws/agent${n}`, view: "C:/w/app" })) };

test("box 3: a folder whose 6 agents run in 3 worktrees shows one folder row, no session rows and no worktree rows", async () => {
  h.wt = [wt, agentWt(1), agentWt(2), agentWt(3), handMade];
  const c = await panel(six, team);
  const seen = visible(c);
  expect(seen.filter((n) => cls(n).includes("proj") && cls(n).includes("folder"))).toHaveLength(1);
  // Txais (2026-11-13): the sessions are the cells of the folder's one grid, not rows in the left ribbon.
  expect(seen.filter((n) => n.attrs["data-session"] !== undefined)).toEqual([]);
  expect(seen.filter((n) => n.attrs["data-worktree"] !== undefined), "no worktree row draws, made for agents or by hand").toEqual([]);
  expect(find(c, (n) => n.attrs["data-worktree"] === "by-hand").length, "the hand-made one is only kept out of sight in the page").toBe(1);
  expect(seen.filter((n) => n.attrs["data-path"] !== undefined).map((n) => n.attrs["data-path"])).toEqual(["C:/w/app"]);
});

test("box 3: clicking the folder row opens the grid every worktree's sessions are shown in", async () => {
  h.wt = [wt, agentWt(1)];
  const c = await panel(six.slice(0, 2));
  const row = find(c, (n) => cls(n).includes("proj") && cls(n).includes("folder"))[0];
  const { click } = await import("../../tasks/fakeDom");
  await click(c, row);
  expect(selected).toEqual(["C:/w/app"]);
  expect(find(c, (n) => n.attrs["data-session"] !== undefined)).toEqual([]);
});

test("box 4: Pinned and the grouped lists hold folders only, never a worktree", async () => {
  h.wt = [wt, agentWt(1)];
  const worktreePinned = await panel([], { pinnedWorkspaces: [agentWt(1).path] });
  expect(find(worktreePinned, (n) => n.attrs["data-group"] === "Pinned")).toEqual([]);
  await unmount();
  const folderPinned = await panel([], { pinnedWorkspaces: [wt.path] });
  expect(find(folderPinned, (n) => n.attrs["data-group"] === "Pinned")).toHaveLength(1);
  await unmount();
  const grouped = await panel(six.slice(0, 2), { workspaceGroupBy: "status" });
  expect(visible(grouped).filter((n) => n.attrs["data-worktree"] !== undefined).map((n) => n.attrs["data-path"])).toEqual(["C:/w/app"]);
  expect(find(grouped, (n) => n.attrs["data-session"] !== undefined)).toEqual([]);
});

// Txais (2026-11-12): the sidebar shows folders only; every session is already in the grid. Grouping by status,
// pull request or one flat list still drew a session row under each folder.
test("the sidebar draws no session rows in any grouping", async () => {
  for (const workspaceGroupBy of ["project", "status", "pr", "none"]) {
    const c = await panel(six, { workspaceGroupBy });
    expect(find(c, (n) => n.attrs["data-session"] !== undefined || n.attrs["data-testid"] === "sidebar-session"), workspaceGroupBy).toEqual([]);
    expect(find(c, (n) => n.attrs["data-path"] === "C:/w/app").length, workspaceGroupBy).toBeGreaterThan(0); // the folder row is still drawn
    await unmount();
  }
});

// Txais (2026-11-13): the worktree rows are gone from the ribbon, so what they offered is reached from the pane-header
// chip: the window store hands the panel a worktreeRequest and the panel pops the same row menu at the chip.
test("box 5: a worktree request from a pane-header chip opens that worktree's menu, with the actions its row had", async () => {
  h.wt = [wt, agentWt(1)];
  const c = await panel(six.slice(0, 2), team, { worktreeRequest: { path: agentWt(1).path, x: 40, y: 60, n: Date.now() } });
  await settle(120);
  const menu = find(c, (n) => n.attrs.role === "menu");
  expect(menu).toHaveLength(1);
  expect(menu[0].attrs["data-menu-for"]).toBe(agentWt(1).path);
  const items = find(menu[0], (n) => n.attrs.role === "menuitem").map((n) => n.textContent.trim());
  expect(items).toContain("New session here");
  expect(items).toContain("Start new sessions here");
  expect(items.some((t) => /delete|remove/i.test(t))).toBe(true);
  expect(items.some((t) => /details/i.test(t))).toBe(true);
});

test("box 5: an old worktree request (the sidebar opened later) pops no menu", async () => {
  h.wt = [wt, agentWt(1)];
  const c = await panel(six.slice(0, 2), team, { worktreeRequest: { path: agentWt(1).path, x: 40, y: 60, n: Date.now() - 60000 } });
  expect(find(c, (n) => n.attrs.role === "menu")).toEqual([]);
});

// R61-03: an agent that finished in a folder's grid while it was not shown marks the folder's row, as the session rows did.
test("R61-03: an unread folder's row carries the unread mark; a read one does not", async () => {
  const cls = (c: FakeNode) => String(find(c, (n) => n.attrs["data-testid"] === "sidebar-folder")[0]?.attrs.className ?? "").split(" ");
  const read = await panel([]);
  expect(cls(read)).not.toContain("unread");
  await unmount();
  const un = await panel([], {}, { unread: new Set(["C:/w/app"]) });
  expect(cls(un)).toContain("unread");
});
