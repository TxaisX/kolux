// T-709 (DT-C145): mid-merge or mid-rebase, All Changes offers Abort behind an Ask that names what is
// lost; scm_abort runs only after Confirm, and the button is absent when nothing is in progress.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, installDom, mount, settle, until } from "../tasks/fakeDom";
import { emptyStatus, type Status } from "../scm/model";

const h = vi.hoisted(() => ({ status: null as unknown as Status, calls: [] as [string, unknown][], fail: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    h.calls.push([cmd, args]);
    if (cmd === "scm_status") return Promise.resolve(h.status);
    if (cmd === "change_entries") return Promise.resolve([]);
    if (cmd === "scm_abort") {
    if (h.fail) return Promise.reject("not possible");
      h.status = { ...h.status, operation: null, conflicts: [] };
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("../scm/watch", () => ({ watchStatus: () => () => {} }));
vi.mock("../settings/useSettings", () => ({ useSettings: () => ({ settings: {}, error: null, save: () => Promise.resolve(true) }) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  const frames = { requestAnimationFrame: (f: () => void) => setTimeout(f, 0) as unknown as number, cancelAnimationFrame: (n: number) => clearTimeout(n) };
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, ...frames });
  for (const [k, v] of Object.entries(frames)) vi.stubGlobal(k, v);
  h.calls.length = 0;
  h.fail = false;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const conflict: Status["conflicts"][number] = { path: "a.txt", status: "UU", from: null };
async function pane(status: Status) {
  h.status = status;
  const { default: AllChangesPane } = await import("./AllChangesPane");
  const m = await mount(createElement(AllChangesPane, { id: 1, root: "C:/repo" }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return c;
}
const aborts = () => h.calls.filter(([cmd]) => cmd === "scm_abort");
const dialog = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog");

test("no merge or rebase in progress: no Abort button", async () => {
  const c = await pane({ ...emptyStatus, branch: "main" });
  expect(find(c, (n) => n.attrs["data-abort"] !== undefined)).toEqual([]);
  expect(byText(c, "button", "Abort merge")).toEqual([]);
  expect(byText(c, "button", "Abort rebase")).toEqual([]);
  expect(c.textContent).not.toContain("in progress");
  expect(find(c, (n) => n.attrs["aria-label"] === "Commit message")).toHaveLength(1);
});

test("mid-merge: Abort merge asks first, Cancel calls nothing, Confirm calls scm_abort once and the conflicts clear", async () => {
  const c = await pane({ ...emptyStatus, branch: "main", operation: "merge", conflicts: [conflict] });
  const btn = byText(c, "button", "Abort merge");
  expect(btn).toHaveLength(1);
  expect(c.textContent).toContain("A merge is in progress, with 1 file in conflict.");

  await click(c, btn[0]);
  await settle();
  expect(dialog(c)).toHaveLength(1);
  expect(dialog(c)[0].textContent).toContain("The conflicts you resolved (staged or not) are lost");
  expect(aborts()).toEqual([]);
  await click(c, byText(dialog(c)[0], "button", "Cancel")[0]);
  await settle();
  expect(dialog(c)).toEqual([]);
  expect(aborts()).toEqual([]);

  await click(c, byText(c, "button", "Abort merge")[0]);
  await settle();
  await click(c, byText(dialog(c)[0], "button", "Abort merge")[0]);
  await until(() => c.textContent.includes("Abort merge: the workspace is back where it was"));
  expect(aborts()).toEqual([["scm_abort", { worktree: "C:/repo" }]]);
  await until(() => find(c, (n) => n.attrs["data-abort"] !== undefined).length === 0, "the in-progress notice to clear");
  expect(dialog(c)).toEqual([]);
  // act() read the status and the change list again after the abort.
  const after = h.calls.slice(h.calls.findIndex(([cmd]) => cmd === "scm_abort") + 1).map(([cmd]) => cmd);
  expect(after).toEqual(expect.arrayContaining(["scm_status", "change_entries"]));
});

test("mid-rebase: the Ask names the replayed commits it drops", async () => {
  const c = await pane({ ...emptyStatus, branch: null, operation: "rebase", conflicts: [conflict] });
  await click(c, byText(c, "button", "Abort rebase")[0]);
  await settle();
  expect(dialog(c)[0].textContent).toContain("Commits already replayed onto the new base are thrown away (the branch keeps the commits it had)");
  expect(aborts()).toEqual([]);
});

test("mid-cherry-pick: the Ask says the commits it already made are removed", async () => {
  const c = await pane({ ...emptyStatus, branch: "main", operation: "cherry-pick", conflicts: [conflict] });
  await click(c, byText(c, "button", "Abort cherry-pick")[0]);
  await settle();
  expect(dialog(c)[0].textContent).toContain("Commits the cherry-pick already made are removed from the branch");
  expect(dialog(c)[0].textContent).not.toContain("may not all come back");
  expect(aborts()).toEqual([]);
});

test("a failed abort says so in the warning colour and leaves the notice up", async () => {
  h.fail = true;
  const c = await pane({ ...emptyStatus, branch: "main", operation: "merge", conflicts: [conflict] });
  await click(c, byText(c, "button", "Abort merge")[0]);
  await settle();
  await click(c, byText(dialog(c)[0], "button", "Abort merge")[0]);
  await until(() => c.textContent.includes("Abort merge failed: not possible"));
  expect(find(c, (n) => n.attrs.role === "alert" && n.textContent.includes("Abort merge failed"))).toHaveLength(1);
  expect(aborts()).toHaveLength(1);
  expect(find(c, (n) => n.attrs["data-abort"] === "merge")).toHaveLength(1);
});
