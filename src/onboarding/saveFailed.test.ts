// T-735 (DT-C171, backlog-sweep-49 #18): a setup-step setting whose save fails must not look saved. The real
// panels and the real useSettings are mounted; the host refuses the write, and the control goes back with the
// reason shown.
import { createElement, type ReactElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { FakeNode, find, installDom, mount, settle, typeInto, until, withText } from "../tasks/fakeDom";

const host = { stored: {} as Record<string, unknown>, reads: 0, readsOk: Infinity };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "get_settings") {
      if (++host.reads > host.readsOk) throw new Error("settings file is locked");
      return { ...host.stored };
    }
    if (cmd === "guide_get") return { tried: [] };
    if (cmd === "settings_patch") throw new Error("disk is full");
    return null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

beforeEach(() => Object.assign(host, { stored: { notifyOnFinish: false }, reads: 0, readsOk: Infinity }));

const props = (n: FakeNode) => (n as unknown as Record<string, Record<string, unknown>>)[Object.keys(n).find((k) => k.startsWith("__reactProps$"))!];

async function draw(el: () => Promise<ReactElement>, ready: (c: FakeNode) => FakeNode | undefined) {
  const { doc } = installDom();
  const { container } = await mount(await el(), doc);
  await until(() => !!ready(container));
  return container;
}
const switchIn = (c: FakeNode) => find(c, (n) => n.attrs.role === "switch")[0];

async function failed(c: FakeNode) {
  const { SAVE_FAILED } = await import("./StepPanels");
  await until(() => withText(c, "p", SAVE_FAILED).length > 0, "the save error");
  await settle();
  expect(withText(c, "p", SAVE_FAILED)[0].textContent).toContain("disk is full");
}

test("T-735: a setting that fails to save goes back to what is stored and says why", async () => {
  const c = await draw(async () => createElement((await import("./StepPanels")).NotificationsPanel), switchIn);
  expect(props(switchIn(c)).checked).toBe(false);
  (props(switchIn(c)).onChange as (e: unknown) => void)({ target: { checked: true } });
  await failed(c);
  expect(props(switchIn(c)).checked, "the switch shows what is stored, not the refused change").toBe(false);
});

test("T-735: when the stored settings cannot be read back either, the switch still goes back", async () => {
  const c = await draw(async () => createElement((await import("./StepPanels")).NotificationsPanel), switchIn);
  host.readsOk = host.reads + 1; // the save reads once before it writes; the read after the refused write fails
  (props(switchIn(c)).onChange as (e: unknown) => void)({ target: { checked: true } });
  await failed(c);
  expect(props(switchIn(c)).checked, "back to what the page showed before").toBe(false);
});

test("T-735: the commit writer's instructions box shows the stored text again after a refused save", async () => {
  host.stored = { commitWriterInstructions: "Keep it short." };
  const box = (c: FakeNode) => find(c, (n) => n.localName === "textarea")[0];
  const c = await draw(async () => createElement((await import("./StepPanels")).StopSetup, { stop: "ship", taskSource: false }), box);
  await typeInto(c, box(c), "Write a novel.");
  (props(box(c)).onBlur as (e: unknown) => void)({ target: box(c) });
  await failed(c);
  expect(box(c).value).toBe("Keep it short.");
});
