// T-754 (DT-C190): an empty screen with no sessions offers a way to start one, so a first-time user is never left without
// a button. The Board that first carried this check is gone; the Agents screen's empty state keeps it. The real Content is
// mounted under the window store.
import { createElement } from "react";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
import { click, find, installDom, mount, settle } from "../../test/fakeDom";
import type { WindowBag } from "../windowBag";
import { WindowStoreProvider } from "./store";

test("T-754: the empty Agents screen shows a Start agents button, and a click runs addChooser", async () => {
  const { doc, win } = installDom();
  Object.assign(win, { setTimeout, clearTimeout, setInterval, clearInterval });
  const { default: WindowContent } = await import("./Content");
  const addChooser = vi.fn();
  const bag = { agentsScreen: true, selected: null, panes: [], saved: [], waiting: [], standIns: [], projects: [], lanes: [], cells: [], shown: [], addChooser, settings: {}, agentPass: { looking: true, done: false, error: null } } as unknown as WindowBag;
  const { container, unmount } = await mount(createElement(WindowStoreProvider, { store: bag, children: createElement(WindowContent) }), doc);
  expect(container.textContent).toContain("Looking for agents…");
  const button = find(container, (n) => n.localName === "button" && n.textContent.trim() === "Start agents")[0];
  expect(button, "the empty Agents screen has a Start agents button").toBeDefined();
  await click(container, button);
  await settle();
  expect(addChooser).toHaveBeenCalledTimes(1);
  await unmount();
});
