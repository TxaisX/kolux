// @vitest-environment happy-dom
// T-696 (DT-C132) G1: the palette's filter selects (src/ui Selects) add a chip, then go back to their prompt; the picked
// entry leaves the list, and the chip removes it again. On a real DOM, where a Select's list opens.
import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { Project, Worktree } from "./model";
import { click, find, installDom, mount, settle, until, type FakeNode } from "../tasks/realDom";

const h = vi.hoisted(() => ({ lists: {} as Record<string, unknown[]> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => Promise.resolve(cmd === "workspace_list" ? (h.lists[String(args.projectId)] ?? []) : null),
}));

let unmount: () => Promise<void> = async () => {};
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const chips = (c: FakeNode) => find(c, (n) => n.getAttribute("class") === "palette-chip").map((n) => n.getAttribute("aria-label"));
const control = (c: FakeNode, label: string) => find(c, (n) => n.getAttribute("role") === "combobox" && n.getAttribute("aria-label") === label)[0];
/** A Select's open list: the listbox its control names (the palette has a listbox of its own). */
const listOf = (c: FakeNode, label: string) => document.getElementById(control(c, label).getAttribute("aria-controls") ?? "") as FakeNode | null;
/** The labels a Select offers: read from its open list. */
async function offered(c: FakeNode, label: string): Promise<string[]> {
  await click(c, control(c, label));
  await until(() => !!listOf(c, label) && !listOf(c, label)!.closest("[hidden]"), `the ${label} list`);
  await settle(60); // a list takes no pick in the moment it opens (the press that opened it is not a pick)
  return find(listOf(c, label)!, (n) => n.getAttribute("role") === "option").map((o: FakeNode) => o.textContent.trim());
}
async function pick(c: FakeNode, label: string, text: string) {
  await offered(c, label);
  // The row's own click(), as a pointer press sends it (Base UI picks a row on that, not on a bare click event).
  const row = find(listOf(c, label)!, (n) => n.getAttribute("role") === "option" && n.textContent.trim() === text)[0];
  await act(async () => row.click());
  await settle();
}

test("G1: picking a repository or a kind adds its chip, the picked entry leaves the list, and the chip removes it again", async () => {
  const w = (path: string, branch: string) => ({ path, branch, head: "abc1234", isMain: false, hidden: false, number: null, comment: "" }) as unknown as Worktree;
  h.lists = { p1: [w("C:/w/app", "main"), w("C:/w/fix", "fix")] };
  installDom();
  const { default: WorktreePalette } = await import("./WorktreePalette");
  const project = { id: "p1", name: "app", path: "C:/w/app" } as unknown as Project;
  const m = await mount(createElement(WorktreePalette, { projects: [project], items: [], prOf: () => null, recent: [], scope: [], hasWorktree: true, onWorktree: () => {}, onCreate: () => {}, onClose: () => {} }));
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await until(() => !!control(c, "Filter by repository"), "the repository filter");
  await pick(c, "Filter by repository", "app (2)");
  await until(() => chips(c).length === 1, "the repository chip");
  expect(chips(c)).toEqual(["Remove the filter Repository: app"]);
  expect(control(c, "Filter by repository").querySelector(".ui-select-value").textContent, "back to its prompt").toBe("+ Repository");
  expect(await offered(c, "Filter by repository"), "the picked repository left the list").toEqual(["+ Repository"]);
  const first = find(listOf(c, "Filter by repository")!, (n) => n.getAttribute("role") === "option")[0];
  await act(async () => first.click());
  await settle();
  await pick(c, "Filter by kind", "Workspaces");
  await until(() => chips(c).length === 2, "the kind chip");
  expect(chips(c)[1]).toBe("Remove the filter Kind: Workspaces");
  expect(await offered(c, "Filter by kind")).not.toContain("Workspaces");
  const kindFirst = find(listOf(c, "Filter by kind")!, (n) => n.getAttribute("role") === "option")[0];
  await act(async () => kindFirst.click());
  await settle();
  await click(c, find(c, (n) => n.getAttribute("aria-label") === "Remove the filter Kind: Workspaces")[0]);
  expect(chips(c)).toEqual(["Remove the filter Repository: app"]);
});
