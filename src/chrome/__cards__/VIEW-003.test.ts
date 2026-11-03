// VIEW-003 acceptance: the real TopBar's search hint and bell buttons.
// MIRROR src/App.tsx:2533 onSearch={() => setPalette(true)} and onScreen={setScreen}; the Inbox renders when screen === "inbox" (App.tsx:2098).
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, click, find, installDom, mount, settle } from "../../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized: () => Promise.resolve(false), onResized: () => Promise.resolve(() => {}) }) }));
vi.mock("../../switcher/AccountSwitcher", () => ({ default: () => null }));
vi.mock("../../usage/UsagePill", () => ({ default: () => null }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open(screen: string) {
  const { default: TopBar } = await import("../TopBar");
  const calls: string[] = [];
  const m = await mount(createElement(TopBar, { screen: screen as never, onScreen: (s: string) => calls.push(`screen ${s}`), onSearch: () => calls.push("search"), sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} }), doc);
  unmount = m.unmount;
  await settle();
  return { c: m.container as FakeNode, calls };
}

test("box 1 (the click half): the search hint is one button that asks for the worktree palette", async () => {
  const { c, calls } = await open("terminals");
  const hint = find(c, (n) => n.localName === "button" && n.attrs.class === "searchbox");
  expect(hint).toHaveLength(1);
  expect(hint[0].textContent).toContain("Search");
  await click(c, hint[0]);
  expect(calls).toEqual(["search"]);
});

test("box 2 (the click half): the bell asks for the Inbox screen; on the Inbox it returns to Terminals", async () => {
  const { c, calls } = await open("terminals");
  const bell = find(c, (n) => n.localName === "button" && n.attrs["aria-label"] === "Inbox");
  expect(bell).toHaveLength(1);
  await click(c, bell[0]);
  expect(calls).toEqual(["screen inbox"]);
  await unmount();
  const again = await open("inbox");
  const bell2 = find(again.c, (n) => n.attrs["aria-label"] === "Inbox")[0];
  expect(bell2.attrs["aria-pressed"]).toBe("true");
  await click(again.c, bell2);
  expect(again.calls).toEqual(["screen terminals"]);
});
