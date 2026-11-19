// The remove questions a user sees before workspaces go: the multi-select bar's one question, and
// the Cleanup dialog's confirm step (PROJ-080, PROJ-082). The real components on the small DOM,
// with the backend mocked.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byLabel, byText, click, installDom, mount, settle, withText } from "../test/fakeDom";
import CleanupDialog from "./CleanupDialog";
import { PickedBar } from "../shell/ProjectsExtras";

const h = vi.hoisted(() => ({ calls: [] as string[], scan: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { paths?: string[] }) => {
    h.calls.push(cmd);
    if (cmd === "cleanup_scan") return Promise.resolve(h.scan);
    if (cmd === "cleanup_remove") return Promise.resolve({ removed: args?.paths ?? [], left: [], kept: [] });
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], stamp: "s", commits: [] });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const ws = { path: "C:/w/ws/fix" };
let doc: FakeDocument;
let removed: string[] = [];
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.calls = [];
  h.scan = { projectId: "p1", rows: [{ path: ws.path, branch: "fix", name: null, idleDays: 30, changes: 0, merged: true, unmerged: false, active: false, locked: false, missing: false, quiet: true, preselect: true, keepsBranch: false, note: null }], error: null, timedOut: false, atMs: 1 };
  removed = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

function BatchHarness() {
  return createElement(PickedBar, {
    picked: [ws.path, "C:/w/ws/two"],
    find: (p: string) => ({ projectId: "p1", name: p.endsWith("fix") ? "fix" : "two" }),
    onRemoved: () => {},
    onLeft: () => {},
    onReload: () => {},
    say: () => {},
  } as never);
}

test("the multi-select question names the folders, the Git-ignored files and the branch outcome", async () => {
  const m = await mount(createElement(BatchHarness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(40);
  await click(c, byText(c, "button", "Remove…")[0]);
  await settle(80);
  expect(byText(c, "h2", "Remove 2 workspaces?")[0], "the batch question is shown").toBeDefined();
  const text = (c.textContent ?? "").replace(/\s+/g, " ");
  expect(text, "says the folders go").toMatch(/folder/i);
  expect(text, "says files Git ignores go").toMatch(/ignor/i);
  expect(text, "says what happens to the branch").toMatch(/branch/i);
});

// PROJ-080 / PROJ-082: Cleanup lists the quiet workspace ticked, asks before it removes, and Cancel removes nothing.
function CleanupHarness() {
  return createElement(CleanupDialog, {
    project: { id: "p1", name: "app" },
    onClose: () => {},
    onRemoved: (paths: string[]) => void removed.push(...paths),
    onKept: () => {},
    parentOf: () => null,
  });
}
const confirmAsk = (c: FakeNode) => byLabel(c, "div", "Confirm removal")[0];

test("the Cleanup dialog names the ticked workspace and Cancel leaves every workspace", async () => {
  const m = await mount(createElement(CleanupHarness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  expect(byLabel(c, "input", "clean up fix")[0], "the quiet workspace is listed").toBeDefined();
  await click(c, byText(c, "button", "Remove 1 ticked")[0]);
  await settle(40);
  expect(confirmAsk(c), "the question comes before anything is removed").toBeDefined();
  expect(withText(confirmAsk(c), "span", "fix").length, "the question names the workspace").toBeGreaterThan(0);
  expect(h.calls).not.toContain("cleanup_remove");
  await click(c, byText(confirmAsk(c), "button", "Cancel")[0]);
  await settle(80);
  expect(confirmAsk(c), "Cancel closes the question").toBeUndefined();
  expect(h.calls).not.toContain("cleanup_remove");
  expect(h.calls).not.toContain("workspace_remove");
  expect(removed).toEqual([]); // nothing was removed
});

test("Remove for good on the Cleanup question removes the ticked workspace and tells the sidebar", async () => {
  const m = await mount(createElement(CleanupHarness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle(120);
  await click(c, byText(c, "button", "Remove 1 ticked")[0]);
  await settle(40);
  await click(c, byText(confirmAsk(c), "button", "Remove for good")[0]);
  await settle(200);
  expect(h.calls).toContain("cleanup_remove");
  expect(removed).toEqual([ws.path]);
});
