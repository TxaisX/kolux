// T-675 (DT-C111; VIEW-014): the Space page's batch delete on the small DOM, with the back end stood in. Fails when
// SpaceView.tsx goes back to deleting every ticked row (even ones the search hides), to dropping keepBranch, or to
// an enabled checkbox on a row that cannot be deleted.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byLabel, click, type FakeDocument, type FakeNode, find, installDom, mount, typeInto, until } from "../tasks/fakeDom";
import type { SpaceRow } from "../projects/space";

const back = vi.hoisted(() => ({ calls: [] as { cmd: string; args: Record<string, unknown> }[], rows: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    back.calls.push({ cmd, args });
    if (cmd === "space_saved") return Promise.resolve([]);
    if (cmd === "space_scan") return Promise.resolve(back.rows);
    if (cmd === "workspace_remove_check") return Promise.resolve({ changes: [], locked: null, nested: [], stamp: `stamp:${String(args.path)}` });
    if (cmd === "workspace_remove_many") {
      const picks = args.picks as { path: string }[];
      return Promise.resolve({ items: picks.map((p) => ({ path: p.path, outcome: "removed", message: null })), summary: `Deleted ${picks.length}` });
    }
    return Promise.resolve(null);
  },
}));

const row = (path: string, branch: string, isMain = false): SpaceRow => ({ path, branch, isMain, size: { bytes: 2048, files: 3, incomplete: false }, modified: 0, reclaimable: !isMain });
const MAIN = "C:/p";
const A = "C:/p/wt/a";
const B = "C:/p/wt/b";
const BUSY = "C:/p/wt/c";

let doc: FakeDocument;
let root: FakeNode;
let unmount: () => Promise<void> = async () => {};
beforeEach(async () => {
  doc = installDom().doc;
  back.calls = [];
  back.rows = [row(MAIN, "main", true), row(A, "feat-a"), row(B, "feat-b"), row(BUSY, "feat-c")];
  const { default: SpaceView } = await import("./SpaceView");
  const m = await mount(createElement(SpaceView, { projectId: "p1", projectName: "p", openDirs: [BUSY] }), doc);
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
const sentMany = () => back.calls.filter((c) => c.cmd === "workspace_remove_many");

test("T-675 Space: a row that cannot be deleted has its box off, with the reason as a tooltip", () => {
  expect(box("main").hasAttribute("disabled")).toBe(true);
  expect(box("main").attrs.title).toBeTruthy();
  expect(box("feat-c").hasAttribute("disabled")).toBe(true);
  expect(box("feat-c").attrs.title).toBeTruthy();
  expect(box("feat-a").hasAttribute("disabled")).toBe(false);
  expect(box("feat-a").hasAttribute("title")).toBe(false);
});

test("T-675 Space: batch delete keeps branches and acts only on ticked rows the table still shows", async () => {
  await click(root, box("feat-a"));
  await click(root, box("feat-b"));
  expect(button((t) => t.startsWith("Delete selected"))?.textContent).toBe("Delete selected (2)");
  await typeInto(root, byLabel(root, "input", "Search worktrees")[0], "feat-a"); // feat-b is ticked but now hidden
  const del = button((t) => t.startsWith("Delete selected"));
  expect(del.textContent).toBe("Delete selected (1)");
  await click(root, del);
  await until(() => button((t) => t === "Delete") !== undefined, "the delete question");
  // the question lists only what will go
  const listed = find(doc.body, (n) => n.attrs.role === "alertdialog")[0]?.textContent ?? "";
  expect(listed).toContain("feat-a");
  expect(listed).not.toContain("feat-b");
  expect(back.calls.filter((c) => c.cmd === "workspace_remove_check").map((c) => c.args.path)).toEqual([A]);
  await click(root, button((t) => t === "Delete"));
  await until(() => sentMany().length === 1, "the batch delete");
  expect(sentMany()[0].args).toEqual({ projectId: "p1", picks: [{ path: A, stamp: `stamp:${A}` }], force: false, keepBranch: true });
});
