// Job 24 item 4 (EDIT-004, as ProjectsPanel's batch delete does since audit F19): the Space page's bulk delete
// drops the unsaved editor drafts of each folder the back end says it removed, and only those.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byLabel, click, type FakeDocument, type FakeNode, find, installDom, mount, until } from "../test/fakeDom";
import type { SpaceRow } from "../projects/space";

const back = vi.hoisted(() => ({ calls: [] as { cmd: string; args: Record<string, unknown> }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    back.calls.push({ cmd, args });
    if (cmd === "space_saved") return Promise.resolve([]);
    if (cmd === "space_scan") return Promise.resolve([row(MAIN, "main", true), row(A, "feat-a"), row(B, "feat-b")]);
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], stamp: `stamp:${String(args.path)}` });
    if (cmd === "workspace_remove_many")
      return Promise.resolve({ items: [{ path: A, outcome: "removed", message: null }, { path: B, outcome: "failed", message: "the folder is locked" }], summary: "Deleted 1 of 2" });
    return Promise.resolve(null);
  },
}));

const row = (path: string, branch: string, isMain = false): SpaceRow => ({ path, branch, isMain, size: { bytes: 2048, files: 3, incomplete: false }, modified: 0, reclaimable: !isMain });
const MAIN = "C:/p";
const A = "C:/p/wt/a";
const B = "C:/p/wt/b";

let doc: FakeDocument;
let root: FakeNode;
let unmount: () => Promise<void> = async () => {};
beforeEach(async () => {
  doc = installDom().doc;
  back.calls = [];
  const { default: SpaceView } = await import("./SpaceView");
  const m = await mount(createElement(SpaceView, { projectId: "p1", projectName: "p", openDirs: [] }), doc);
  unmount = m.unmount;
  root = m.container;
  await until(() => box("feat-a") !== undefined, "the scan to fill the table");
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const box = (label: string) => byLabel(root, "input", `Select ${label}`)[0];
const button = (pred: (text: string) => boolean) => find(doc.body, (n) => n.localName === "button" && pred(n.textContent.trim()))[0];
const dropped = () => back.calls.filter((c) => c.cmd === "editor_drafts_drop").map((c) => c.args);

test("bulk delete drops the drafts of the removed folder and keeps the failed one's", async () => {
  await click(root, box("feat-a"));
  await click(root, box("feat-b"));
  await click(root, button((t) => t.startsWith("Delete selected")));
  await until(() => button((t) => t === "Delete 2") !== undefined, "the delete question");
  expect(dropped()).toEqual([]); // nothing is dropped before the delete
  await click(root, button((t) => t === "Delete 2"));
  await until(() => back.calls.some((c) => c.cmd === "workspace_remove_many"), "the batch delete");
  await until(() => dropped().length > 0, "the drafts drop");
  expect(dropped()).toEqual([{ worktree: A }]);
});
