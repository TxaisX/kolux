// The Ports popover on the small DOM: named buttons, a Stop that cannot be pressed twice and says when it failed,
// Escape that closes it with focus handed back to the trigger.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, FakeNode as Node, click, find, installDom, mount, settle, until } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ stop: null as null | { resolve: (v: string) => void; reject: (e: string) => void }, rows: [] as unknown[], stops: 0 }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "ports_list") return Promise.resolve(h.rows);
    if (cmd === "ports_stop") return new Promise((resolve, reject) => (h.stops++, (h.stop = { resolve, reject })));
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("../browser/openIn", () => ({ openInBrowser: () => {} }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let keydown: ((e: unknown) => void)[] = [];
const focused: unknown[] = [];
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  keydown = [];
  focused.length = 0;
  Object.assign(dom.win, {
    setInterval, clearInterval, setTimeout, clearTimeout, innerWidth: 1000, innerHeight: 800,
    addEventListener: (t: string, fn: (e: unknown) => void) => void (t === "keydown" && keydown.push(fn)),
    removeEventListener: (t: string, fn: (e: unknown) => void) => void (keydown = keydown.filter((f) => f !== fn || t !== "keydown")),
  });
  Object.assign(Node.prototype, { getBoundingClientRect: () => ({ left: 10, top: 780 }), isConnected: true, focus() { focused.push(this); } });
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
  const m = await mount(createElement(PortsItem, { active: "w", workspaces: ["w"] }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return c;
}
const trigger = (c: FakeNode) => find(c, (n) => n.attrs["data-item"] === "ports")[0];
const dialog = (c: FakeNode) => find(c, (n) => n.attrs.role === "dialog")[0];
const labelled = (c: FakeNode, label: string) => find(c, (n) => n.attrs["aria-label"] === label)[0];

test("Open and Stop name their port, and Stop is off while it runs and then reports a failure", async () => {
  const c = await page();
  await click(c, trigger(c));
  await until(() => !!labelled(c, "Stop port 5173"));
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
  expect(find(c, (n) => n.localName === "div" && String(n.attrs.className ?? n.attrs.class ?? "") === "note error")).toHaveLength(1);
});

test("Escape closes the popover and gives focus back to the trigger", async () => {
  const c = await page();
  await click(c, trigger(c));
  await until(() => !!dialog(c));
  expect(focused).toContain(dialog(c));
  expect(keydown.length).toBe(1);
  const e = { key: "Escape", stopPropagation: vi.fn(), preventDefault: vi.fn() };
  keydown[0](e);
  await until(() => !dialog(c));
  expect(e.stopPropagation).toHaveBeenCalled();
  expect(focused[focused.length - 1]).toBe(trigger(c));
  expect(keydown.length).toBe(0);
});

test("the status region is mounted before a note fills it", async () => {
  const c = await page();
  await click(c, trigger(c));
  await until(() => !!labelled(c, "Stop port 5173"));
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
  await click(c, trigger(c));
  await until(() => !!labelled(c, "Stop port 5173"));
  doc.activeElement = labelled(c, "Stop port 5173");
  await click(c, labelled(c, "Stop port 5173"));
  focused.length = 0;
  h.stop!.resolve("stopped");
  h.rows = [];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  await until(() => !labelled(c, "Stop port 5173"));
  await until(() => focused.includes(dialog(c)));
});

test("a Stop that was not focused leaves focus alone when its row goes", async () => {
  const c = await page();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await click(c, trigger(c));
  await until(() => !!labelled(c, "Stop port 5173"));
  await click(c, labelled(c, "Stop port 5173"));
  focused.length = 0;
  h.stop!.resolve("stopped");
  h.rows = [];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  await until(() => !labelled(c, "Stop port 5173"));
  expect(focused).not.toContain(dialog(c));
});
