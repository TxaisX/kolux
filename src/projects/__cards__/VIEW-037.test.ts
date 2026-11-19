// VIEW-037 acceptance: the real worktree palette mounted on the small DOM (src/tasks/fakeDom.ts), commands mocked.
// MIRROR src/App.tsx:1632 paletteItems(): the Settings rows are { section: "Settings", label: PAGES[id], hint: "Settings page", run: openSettings(id) }.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, fire, installDom, mount, settle, typeInto, until } from "../../test/fakeDom";
import { PAGES, type PageId } from "../../settings/pages";
import type { Project, Worktree } from "../model";

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
  h.lists = { p1: [{ ...w("C:/w/app", "main"), isMain: true }, w("C:/w/fix", "fix-login-redirect"), w("C:/w/doc", "docs-refresh")] };
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open() {
  const { default: WorktreePalette } = await import("../WorktreePalette");
  const picked: string[] = [];
  const opened: string[] = [];
  const items = (Object.keys(PAGES) as PageId[]).map((id) => ({ section: "Settings", label: PAGES[id], hint: "Settings page", run: () => opened.push(id) }));
  const m = await mount(createElement(WorktreePalette, { projects: [project], items, prOf: () => null, recent: [], scope: [], hasWorktree: true, onWorktree: (x: Worktree) => picked.push(x.path), onCreate: (n: string) => picked.push(`create ${n}`), onClose: () => picked.push("close") }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return { c, picked, opened, box: find(c, (n) => n.localName === "input" && n.attrs.class === "picker-input")[0] };
}
const rowText = (c: FakeNode) => find(c, (n) => n.attrs.role === "option").map((n) => n.textContent);

test("box 1: part of a branch name lists that worktree, and Enter switches to it", async () => {
  const { c, picked, box } = await open();
  await typeInto(c, box, "login-red");
  await until(() => rowText(c).some((t) => t.includes("fix-login-redirect")), "the worktree row");
  expect(rowText(c).filter((t) => t.includes("docs-refresh"))).toEqual([]);
  expect(rowText(c)[0]).toContain("fix-login-redirect");
  await fire(c, "keydown", box, { key: "Enter" });
  expect(picked).toEqual(["close", "C:/w/fix"]);
});

test("box 2: a settings page name gives a row that opens that page", async () => {
  const { c, picked, opened, box } = await open();
  await typeInto(c, box, "appearance");
  await until(() => rowText(c).some((t) => t.includes("Appearance")), "the settings row");
  expect(rowText(c)[0]).toContain("Appearance");
  await fire(c, "keydown", box, { key: "Enter" });
  expect(opened).toEqual(["appearance"]);
  expect(picked).toEqual(["close"]);
});
