// T-675 (DT-C111): the Tower's wiring on the small DOM, not only its helpers. Each test fails when its line in
// TowerView.tsx / TowerWindow.tsx is reverted: the selected row is revealed on a key, Refresh reads Refreshing…
// and settles (also under StrictMode's dev double mount), and the own window says Loading… until its first reading.
import { act, createElement, StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, FakeNode, find, fire, installDom, mount } from "../tasks/fakeDom";
import TowerView from "./TowerView";
import { towerRows, type Seat } from "./tower";

const bridge = vi.hoisted(() => ({ handler: null as null | ((e: { payload: unknown }) => void) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, fn: (e: { payload: unknown }) => void) => {
    bridge.handler = fn;
    return Promise.resolve(() => {});
  },
  emitTo: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: () => Promise.resolve() }) }));

const seat = (key: number): Seat => ({ key, agent: "claude", title: `pane ${key}`, branch: null, cwd: null, account: null, chip: null, meter: null, since: 0 });
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
const scrolled: string[] = [];
const proto = FakeNode.prototype as unknown as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, {
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (h: number) => globalThis.clearTimeout(h),
    setInterval: (...a: Parameters<typeof setInterval>) => globalThis.setInterval(...a),
    clearInterval: (h: number) => globalThis.clearInterval(h),
  });
  scrolled.length = 0;
  bridge.handler = null;
  proto.querySelector = function (this: FakeNode, sel: string) {
    return find(this, (n) => `#${n.attrs.id}` === sel)[0] ?? null;
  };
  proto.scrollIntoView = function (this: FakeNode) {
    scrolled.push(this.attrs.id);
  };
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  delete proto.querySelector;
  delete proto.scrollIntoView;
  vi.useRealTimers();
});

async function start(el: ReturnType<typeof createElement>) {
  const m = await mount(el, doc);
  unmount = m.unmount;
  return m.container;
}
/** Moves the fake clock, running React effects and promises as it goes. */
const pump = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const refreshButton = (root: FakeNode) => find(root, (n) => n.localName === "button" && n.attrs.class === "refresh")[0];

test("T-675 Tower: Down on the list scrolls the newly selected row into view", async () => {
  const root = await start(createElement(TowerView, { rows: towerRows([seat(1), seat(2), seat(3)]), usage: [], now: 0, onOpen: () => {} }));
  const list = find(root, (n) => n.attrs.role === "listbox")[0];
  scrolled.length = 0;
  await fire(root, "keydown", list, { key: "ArrowDown" });
  await fire(root, "keydown", list, { key: "ArrowDown" });
  expect(list.attrs["aria-activedescendant"]).toBe("tower-2");
  expect(scrolled).toEqual(["tower-1", "tower-2"]);
});

const refreshCase = async (strict: boolean) => {
  let reads = 0;
  const view = createElement(TowerView, { rows: towerRows([seat(1)]), usage: [], now: 0, onOpen: () => {}, onRefresh: () => void reads++ });
  const root = await start(strict ? createElement(StrictMode, null, view) : view);
  const button = refreshButton(root);
  await click(root, button);
  expect(button.textContent).toBe("Refreshing…");
  // aria-disabled, never disabled: the button keeps the keyboard, and a second press while it works does nothing
  expect(button.attrs["aria-disabled"]).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(false);
  await click(root, button);
  expect(reads).toBe(1);
  await pump(800);
  expect(button.textContent).toBe("Refresh");
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  await click(root, button);
  expect(reads).toBe(2);
};

test("T-675 Tower: Refresh reads Refreshing… and ignores presses while it works, then settles", async () => {
  await refreshCase(false);
});

test("T-675 Tower: under StrictMode's dev double mount, Refresh still settles back to Refresh", async () => {
  await refreshCase(true);
});

test("T-675 Tower window: Loading… until the first reading arrives, then the real list", async () => {
  const { default: TowerWindow } = await import("./TowerWindow");
  const root = await start(createElement(TowerWindow));
  expect(root.textContent).toContain("Loading…");
  expect(root.textContent).not.toContain("Nothing is running");
  await pump(0);
  expect(bridge.handler).not.toBeNull();
  await act(async () => bridge.handler!({ payload: { seats: [], usage: [] } }));
  expect(root.textContent).not.toContain("Loading…");
  expect(root.textContent).toContain("Nothing is running");
});

