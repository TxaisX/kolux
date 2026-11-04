// T-744 (DT-C180, destructive.md F4): a delete question asked in one project does not survive a switch to another;
// before, it stayed open and its Delete sent the first project's folders under the second project's id. A check or a
// delete still running at the switch drops its answer too, so the second project never shows the first one's rows.
import { act, createElement, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { byLabel, click, find, installDom, mount, settle, until } from "../tasks/fakeDom";
import type { SpaceRow } from "../projects/space";

const back = vi.hoisted(() => ({ calls: [] as { cmd: string; args: Record<string, unknown> }[], gate: null as Promise<void> | null, gateOn: "", checkFails: false }));
const row = (path: string, branch: string, isMain = false): SpaceRow => ({ path, branch, isMain, size: { bytes: 2048, files: 3, incomplete: false }, modified: 0, reclaimable: !isMain });
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    back.calls.push({ cmd, args });
    if (cmd === back.gateOn && back.gate) await back.gate;
    if (cmd === "space_saved") return [];
    if (cmd === "space_scan") return args.projectId === "p1" ? [row("C:/p", "main", true), row("C:/p/wt/a", "feat-a"), row("C:/p/wt/b", "feat-b")] : [row("C:/q", "main", true)];
    if (cmd === "workspace_remove_check" && back.checkFails) throw new Error("the folder is locked");
    if (cmd === "workspace_remove_check") return { changes: [], locked: null, nested: [], stamp: "s" };
    if (cmd === "workspace_remove_many") return { items: [{ path: "C:/p/wt/a", outcome: "removed", message: null }], summary: "Deleted 1 worktree" };
    return null;
  },
}));

let unmount: () => Promise<void> = async () => {};
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  back.calls = [];
  back.gate = null;
  back.gateOn = "";
  back.checkFails = false;
});

async function open() {
  const { doc } = installDom();
  const { default: SpaceView } = await import("./SpaceView");
  let pick: (id: string) => void = () => {};
  const Host = () => {
    const [id, setId] = useState("p1");
    pick = setId;
    return createElement(SpaceView, { projectId: id, projectName: id, openDirs: [] });
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  const buttons = (text: string) => find(doc.body, (n) => n.localName === "button" && n.textContent.trim() === text);
  const status = () => find(doc.body, (n) => n.getAttribute?.("role") === "status").map((n) => n.textContent).join(" ");
  await until(() => byLabel(m.container, "input", "Select feat-a").length > 0, "the first project's rows");
  await click(m.container, byLabel(m.container, "input", "Select feat-a")[0]);
  const ask = () => click(m.container, find(doc.body, (n) => n.localName === "button" && n.textContent.trim().startsWith("Delete selected"))[0]);
  const to = async (id: string) => (await act(async () => pick(id)), await settle());
  return { container: m.container, buttons, status, ask, to };
}
const held = (cmd: string) => {
  let go = () => {};
  back.gate = new Promise<void>((r) => (go = r));
  back.gateOn = cmd;
  return () => act(async () => (go(), await settle()));
};

test("T-744: switching project closes a delete question asked in the last one", async () => {
  const v = await open();
  await v.ask();
  await until(() => v.buttons("Delete").length > 0, "the delete question");
  await v.to("p2");
  expect(v.buttons("Delete"), "no question left from p1").toHaveLength(0);
  await v.to("p1");
  await until(() => byLabel(v.container, "input", "Select feat-a").length > 0, "back on the first project");
  expect(v.buttons("Delete"), "nor after switching back").toHaveLength(0);
  expect(back.calls.map((c) => c.cmd)).not.toContain("workspace_remove_many");
});

test("T-744: checks that end after a switch open no question in the new project", async () => {
  const release = held("workspace_remove_check");
  const v = await open();
  await v.ask();
  expect(back.calls.some((c) => c.cmd === "workspace_remove_check" && c.args.projectId === "p1"), "p1 check held").toBe(true);
  await v.to("p2");
  await release();
  expect(v.buttons("Delete"), "no p1 question on p2").toHaveLength(0);
  expect(back.calls.map((c) => c.cmd)).not.toContain("workspace_remove_many");
});

test("T-744: a check that fails after a switch shows no p1 skip note on the new project", async () => {
  back.checkFails = true;
  const release = held("workspace_remove_check");
  const v = await open();
  await v.ask();
  await v.to("p2");
  await release();
  expect(v.status(), "no p1 skip note on p2").not.toContain("Skipped");
});

test("T-744: a delete that ends after a switch leaves the new project's rows alone", async () => {
  const v = await open();
  await v.ask();
  await until(() => v.buttons("Delete").length > 0, "the delete question");
  const release = held("workspace_remove_many");
  await click(v.container, v.buttons("Delete")[0]);
  await v.to("p2");
  await release();
  expect(back.calls.find((c) => c.cmd === "workspace_remove_many")?.args.projectId, "the delete went to p1").toBe("p1");
  expect(byLabel(v.container, "input", "Select feat-b"), "p1's rows not drawn on p2").toHaveLength(0);
  expect(v.status(), "p1's note not shown on p2").not.toContain("Deleted 1 worktree");
});
