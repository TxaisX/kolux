// VIEW-002 acceptance (boxes 3-4): the real TopBar switch and the real useMenuBar send the native menu its state; the menu ticks
// and the dropped Workspace View are asserted on the Rust side by menu::tests::t054_... and menu::tests::t049b_...
// MIRROR src/App.tsx:538 useMenuBar(menuBarState(settings, screen, chords, classic), ...) and App.tsx:2533 onScreen={setScreen}.
// Box 1 (cycle order) and box 2 (the chord in Classic) are decided in App.tsx (nextScreen, and `if (!classic)` at :727), see the ledger.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, click, find, installDom, mount, settle } from "../../tasks/fakeDom";

const synced: Record<string, unknown>[] = [];
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args: { state?: Record<string, unknown> } = {}) => (cmd === "menu_sync" && args.state && synced.push(args.state), Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized: () => Promise.resolve(false), onResized: () => Promise.resolve(() => {}) }) }));
vi.mock("../../switcher/AccountSwitcher", () => ({ default: () => null }));
vi.mock("../../usage/UsagePill", () => ({ default: () => null }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
const ctl: { setClassic: (c: boolean) => void } = { setClassic: () => {} };
beforeEach(() => {
  ({ doc } = installDom());
  synced.length = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open() {
  const { default: TopBar } = await import("../TopBar");
  const { useMenuBar } = await import("../useChrome");
  const { menuBarState } = await import("../chromeItems");
  const Bar = () => {
    const [screen, setScreen] = useState<"board" | "terminals" | "tower">("terminals");
    const [classic, setClassic] = useState(false);
    ctl.setClassic = setClassic;
    useMenuBar(menuBarState({}, screen, () => undefined, classic), () => {});
    return createElement(TopBar, { screen, classic, onScreen: setScreen as never, sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} });
  };
  const m = await mount(createElement(Bar), doc);
  unmount = m.unmount;
  await settle();
  return m.container as FakeNode;
}
const label = (c: FakeNode, text: string) => find(c, (n) => n.localName === "button" && n.attrs["aria-pressed"] !== undefined && n.textContent.trim() === text)[0];
const last = () => synced[synced.length - 1];

test("box 3: switching to Board with the mouse sends the menu screen board (Rust ticks screen.board for it)", async () => {
  const c = await open();
  expect(last()).toMatchObject({ screen: "terminals", classic: false });
  await click(c, label(c, "Board"));
  await settle();
  expect(label(c, "Board").attrs["aria-pressed"]).toBe("true");
  expect(last()).toMatchObject({ screen: "board", classic: false });
});

test("box 4: turning the new look off sends classic, and the top-bar switch is gone", async () => {
  const c = await open();
  expect(label(c, "Board")).toBeDefined();
  const { act } = await import("react");
  await act(async () => ctl.setClassic(true));
  await settle();
  expect(last()).toMatchObject({ classic: true });
  expect(label(c, "Board")).toBeUndefined();
});
