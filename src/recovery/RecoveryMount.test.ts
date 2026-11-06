// T-724 (DT-C160): the graphics prompt closes only when the choice went through. Keep Running and Stay in safe
// graphics used to close it even when the save failed, so the next launch asked again with no word why.
// The real RecoveryMount on the small DOM; the commands are stand-ins that fail on demand.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byText, click, type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ fail: null as string | null, calls: [] as [string, unknown][], lost: [] as (() => void)[], notes: null as { onRepair?: () => void } | null, settingsFailed: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    if (cmd === "graphics_launch_choice") return Promise.resolve({ version: "1", chosen: false });
    if (cmd === "graphics_crash_noted") return Promise.resolve(true);
    if (cmd === "ui_heartbeat" || cmd === "update_last_attempt" || cmd === "startup_recovery_notes") return Promise.resolve(null);
    if (cmd === "settings_state") return Promise.resolve({ failed: h.settingsFailed });
    h.calls.push([cmd, args]);
    if (cmd === "settings_repair") return Promise.resolve(["C:\\p\\settings.json.corrupt-1"]);
    return h.fail ? Promise.reject(h.fail) : Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("./CrashReportDialog", () => ({ default: () => null }));
vi.mock("./RecoveryNotes", () => ({
  default: (props: { onRepair?: () => void }) => {
    h.notes = props;
    return null;
  },
}));
vi.mock("./startupNotes", () => ({ loadRecoveryNotes: () => Promise.resolve([]) }));
vi.mock("../update/bus", () => ({ requestUpdateCheck: () => {} }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, addEventListener: (_: string, f: () => void) => void h.lost.push(f), removeEventListener() {} });
  h.fail = null;
  h.calls = [];
  h.lost = [];
  h.notes = null;
  h.settingsFailed = false;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function show() {
  const { default: RecoveryMount } = await import("./RecoveryMount");
  const m = await mount(createElement(RecoveryMount), doc);
  unmount = m.unmount;
  await until(() => prompt(m.container as FakeNode).length === 1, "the graphics prompt");
  return m.container as FakeNode;
}
const prompt = (c: FakeNode) => find(c, (n) => n.attrs["aria-label"] === "Graphics");
const told = (c: FakeNode) => find(c, (n) => n.attrs.role === "status").map((n) => n.textContent);

test("Stay in safe graphics: a failed save keeps the prompt open and says why; a save that lands closes it", async () => {
  const c = await show();
  h.fail = "disk full";
  await click(c, byText(c, "button", "Stay in safe graphics")[0]);
  await until(() => told(c).length === 1, "the failure line");
  expect(told(c)[0]).toBe("Could not save Stay in safe graphics: disk full");
  expect(prompt(c)).toHaveLength(1);
  h.fail = null;
  await click(c, byText(c, "button", "Stay in safe graphics")[0]);
  await until(() => prompt(c).length === 0, "the prompt to close");
  expect(h.calls).toEqual([["graphics_choose", { stay: true }], ["graphics_choose", { stay: true }]]);
});

test("Keep Running after a burst: a failed save keeps the prompt open and says why; a save that lands closes it", async () => {
  const c = await show();
  await click(c, byText(c, "button", "Stay in safe graphics")[0]); // clear the launch prompt so the burst one shows
  await until(() => prompt(c).length === 0, "the launch prompt to close");
  h.lost.forEach((f) => f());
  await until(() => byText(c, "button", "Keep Running").length === 1, "the burst prompt");
  h.fail = "access denied";
  await click(c, byText(c, "button", "Restart in safe graphics")[0]);
  await until(() => told(c).length === 1, "the restart failure line");
  expect(told(c)[0]).toBe("Could not restart in safe graphics: access denied");
  h.fail = "no app data folder";
  await click(c, byText(c, "button", "Keep Running")[0]);
  await until(() => told(c)[0] !== "Could not restart in safe graphics: access denied", "the line to change");
  await until(() => told(c).length === 1, "the failure line");
  expect(told(c)[0]).toBe("Could not save Keep Running: no app data folder");
  expect(prompt(c)).toHaveLength(1);
  h.fail = null;
  await click(c, byText(c, "button", "Keep Running")[0]);
  await until(() => prompt(c).length === 0, "the prompt to close");
  expect(h.calls.slice(1).map(([cmd]) => cmd)).toEqual(["graphics_restart_safe", "graphics_keep_running", "graphics_keep_running"]);
});

test("Try hardware again: a failure is told, the next choice clears the line, and Stay after a failure still closes the prompt", async () => {
  const c = await show();
  h.fail = "restart refused";
  await click(c, byText(c, "button", "Try hardware again")[0]);
  await until(() => told(c).length === 1, "the failure line");
  expect(told(c)[0]).toBe("Could not switch back to hardware graphics: restart refused");
  h.fail = null;
  await click(c, byText(c, "button", "Try hardware again")[0]); // works: the app would restart, the prompt stays
  await settle(30);
  expect(told(c)).toEqual([]);
  expect(prompt(c)).toHaveLength(1);
  h.fail = "restart refused";
  await click(c, byText(c, "button", "Try hardware again")[0]);
  await until(() => told(c).length === 1, "the failure line again");
  h.fail = null;
  await click(c, byText(c, "button", "Stay in safe graphics")[0]); // another button after a failure: saved, so it closes
  await until(() => prompt(c).length === 0, "the prompt to close");
});

test("C22-R2-01: a settings file that cannot be read offers Repair, and it calls settings_repair", async () => {
  h.settingsFailed = true;
  await show();
  await until(() => !!h.notes?.onRepair, "the repair action");
  h.notes!.onRepair!();
  await until(() => h.calls.some(([cmd]) => cmd === "settings_repair"), "the repair command");
  expect(h.calls.filter(([cmd]) => cmd === "settings_repair")).toHaveLength(1);
});

test("C22-R2-01: a settings file that reads is offered no Repair", async () => {
  await show();
  await settle(30);
  expect(h.notes?.onRepair).toBeUndefined();
});
