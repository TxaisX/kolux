// VIEW-040 acceptance: the real worktree palette on the small DOM, rows fed through the real atOf-shaped mapping.
// MIRROR src/App.tsx:2541 atOf(): { mark: dirMark(state, unread, watching), since: row.changed }; the decision is dirMark.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../../test/fakeDom";
import type { Project, Worktree } from "../model";
import { dirMark, type RowAt } from "../WorktreePalette";

const h = vi.hoisted(() => ({ lists: {} as Record<string, unknown[]> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => Promise.resolve(cmd === "workspace_list" ? (h.lists[String(args.projectId)] ?? []) : null),
}));
const w = (path: string, branch: string): Worktree => ({ path, branch, head: "abc1234", isMain: false, hidden: false, number: null, comment: "" }) as unknown as Worktree;
const project = { id: "p1", name: "app", path: "C:/w/app" } as unknown as Project;
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};

beforeEach(() => {
  ({ doc } = installDom());
  h.lists = { p1: [{ ...w("C:/w/app", "main"), isMain: true }, w("C:/w/fix", "fix-login"), w("C:/w/old", "old-work")] };
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open(atOf: (d: string) => RowAt) {
  const { default: WorktreePalette } = await import("../WorktreePalette");
  const m = await mount(createElement(WorktreePalette, { projects: [project], items: [], prOf: () => null, atOf, recent: [], scope: [], hasWorktree: true, onWorktree: () => {}, onCreate: () => {}, onClose: () => {} }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return c;
}
const rows = (c: FakeNode) => find(c, (n) => n.attrs.role === "option");
const rowFor = (c: FakeNode, text: string) => rows(c).find((n) => n.textContent.includes(text));
const labels = (n: FakeNode) => find(n, (x) => x.attrs["aria-label"] !== undefined).map((x) => x.attrs["aria-label"]);

test("box 1: an agent waiting on approval with unread output shows the permission mark on its row", async () => {
  const at = (d: string): RowAt => {
    if (!d.endsWith("fix")) return null;
    const mark = dirMark("waiting", true, false);
    return mark ? { mark, since: Date.now() - 4 * 60_000 } : null;
  };
  const c = await open(at);
  await until(() => rowFor(c, "fix-login") !== undefined, "the fix row");
  const row = rowFor(c, "fix-login")!;
  expect(labels(row)).toEqual(["needs permission"]);
  expect(labels(row)).not.toContain("unread");
  // a row with nothing to show carries no mark
  expect(labels(rowFor(c, "old-work")!)).toEqual([]);
});

test("box 2: finished 50 minutes ago reads 50m; finished three days ago reads 3d", async () => {
  const ago = (ms: number) => Date.now() - ms;
  const at = (d: string): RowAt => (d.endsWith("fix") ? { mark: dirMark("done", false), since: ago(50 * 60_000 + 5_000) } : d.endsWith("old") ? { mark: dirMark("done", false), since: ago(3 * 24 * 3_600_000 + 5_000) } : null);
  const c = await open(at);
  await until(() => rowFor(c, "old-work") !== undefined, "the rows");
  const age = (n: FakeNode) => find(n, (x) => x.attrs.class === "palette-age").map((x) => x.textContent);
  expect(age(rowFor(c, "fix-login")!)).toEqual(["50m"]);
  expect(age(rowFor(c, "old-work")!)).toEqual(["3d"]);
  expect(labels(rowFor(c, "fix-login")!)).toEqual(["done"]);
});
