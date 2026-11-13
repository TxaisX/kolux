// @vitest-environment happy-dom
// The Ports popover (a src/ui Popover) on a real DOM: named buttons, a Stop that cannot be pressed twice and says when
// it failed, Escape that closes it with focus handed back to the trigger, and focus that moves to the popover when the
// focused Stop's row goes.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeNode, click, find, fire, installDom, mount, settle, until } from "../tasks/realDom";

const h = vi.hoisted(() => ({ stop: null as null | { resolve: (v: string) => void; reject: (e: string) => void }, rows: [] as unknown[], stops: 0 }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "ports_list") return Promise.resolve(h.rows);
    if (cmd === "ports_stop") return new Promise((resolve, reject) => (h.stops++, (h.stop = { resolve, reject })));
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  installDom();
  h.stop = null;
  h.stops = 0;
  h.rows = [{ port: 5173, addr: "127.0.0.1", pid: 9, external: false, started: "t", terminal: 7 }];
});
afterEach(async () => {
  vi.useRealTimers();
  await unmount();
  unmount = async () => {};
});

async function page() {
  const { default: PortsItem } = await import("./PortsItem");
  const m = await mount(createElement(PortsItem, { active: "w", workspaces: ["w"] }));
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return c;
}
const trigger = (c: FakeNode) => find(c, (n) => n.attrs["data-item"] === "ports")[0];
const dialog = (c: FakeNode) => find(c, (n) => n.attrs.role === "dialog")[0];
const labelled = (c: FakeNode, label: string) => find(c, (n) => n.attrs["aria-label"] === label)[0];
async function openIt(c: FakeNode) {
  trigger(c).focus();
  await click(c, trigger(c));
  await until(() => !!labelled(c, "Stop port 5173"));
}

test("Open and Stop name their port, and Stop is off while it runs and then reports a failure", async () => {
  const c = await page();
  await openIt(c);
  expect(dialog(c).attrs["aria-label"]).toBe("Ports");
  expect(dialog(c).classList.contains("menu")).toBe(true);
  expect(dialog(c).classList.contains("ports-menu")).toBe(true);
  expect(labelled(c, "Open port 5173")).toBeTruthy();
  await click(c, labelled(c, "Stop port 5173"));
  const stop = labelled(c, "Stop port 5173");
  // aria-disabled, not disabled: a disabled button drops the focus it holds
  expect(stop.attrs["aria-disabled"]).toBe("true");
  expect(stop.attrs.disabled).toBeUndefined();
  expect(stop.textContent).toBe("Stopping…");
  await click(c, stop);
  expect(h.stops).toBe(1);
  h.stop!.reject("refused");
  await until(() => c.textContent.includes("Could not stop port 5173: refused"));
  expect(labelled(c, "Stop port 5173").attrs["aria-disabled"]).toBeUndefined();
  expect(find(c, (n) => n.localName === "div" && n.getAttribute("class") === "note error")).toHaveLength(1);
});

test("the popover takes focus on open; Escape closes it, stops there, and gives focus back to the trigger", async () => {
  const terminal = vi.fn();
  window.addEventListener("keydown", terminal);
  const c = await page();
  await openIt(c);
  await until(() => document.activeElement === dialog(c), "focus on the popover");
  await fire(c, "keydown", document.activeElement!, { key: "Escape" });
  await until(() => !dialog(c), "the popover to close");
  expect(terminal).not.toHaveBeenCalled(); // the key never reached the terminal underneath
  await until(() => document.activeElement === trigger(c), "focus back on the trigger");
  window.removeEventListener("keydown", terminal);
});

test("a press on the trigger while the popover is open closes it", async () => {
  const c = await page();
  await openIt(c);
  await fire(c, "pointerdown", trigger(c));
  await fire(c, "mousedown", trigger(c));
  await click(c, trigger(c));
  await settle();
  expect(dialog(c)).toBeUndefined();
  expect(trigger(c).attrs["aria-expanded"]).toBe("false");
});

test("the status region is mounted before a note fills it", async () => {
  const c = await page();
  await openIt(c);
  const status = find(c, (n) => n.attrs.role === "status")[0];
  expect(status).toBeTruthy();
  expect(status.textContent).toBe("");
  await click(c, labelled(c, "Stop port 5173"));
  h.stop!.reject("refused");
  await until(() => status.textContent.includes("Could not stop port 5173: refused"));
  expect(find(c, (n) => n.attrs.role === "status")[0]).toBe(status);
});

test("when the row whose Stop had focus disappears, focus moves to the popover", async () => {
  const c = await page();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await openIt(c);
  labelled(c, "Stop port 5173").focus();
  await click(c, labelled(c, "Stop port 5173"));
  h.stop!.resolve("stopped");
  h.rows = [];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  await until(() => !labelled(c, "Stop port 5173"));
  await until(() => document.activeElement === dialog(c), "focus on the popover");
});

test("a Stop that was not focused leaves focus alone when its row goes", async () => {
  const c = await page();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await openIt(c);
  // The press comes from the mouse: focus stays where it was (the popover itself), not on the Stop.
  await until(() => document.activeElement === dialog(c), "focus on the popover");
  const moved = vi.spyOn(dialog(c), "focus");
  await click(c, labelled(c, "Stop port 5173"));
  h.stop!.resolve("stopped");
  h.rows = [];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  await until(() => !labelled(c, "Stop port 5173"));
  await settle();
  expect(moved).not.toHaveBeenCalled();
});
