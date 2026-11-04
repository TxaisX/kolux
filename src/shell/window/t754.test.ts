// T-754 (DT-C190): the Board with no sessions offers a way to start one. Before, the empty Board said "No session yet."
// and nothing else, so a first-time user on the Board had no button. The real Content is mounted under the window store.
import { createElement } from "react";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
import { click, find, installDom, mount, settle } from "../../tasks/fakeDom";
import type { WindowBag } from "../windowBag";
import { WindowStoreProvider } from "./store";

test("T-754: the empty Board shows a New session button, and a click runs addChooser", async () => {
  const { doc, win } = installDom();
  Object.assign(win, { setTimeout, clearTimeout, setInterval, clearInterval });
  const { default: WindowContent } = await import("./Content");
  const addChooser = vi.fn();
  const bag = { board: true, panes: [], saved: [], waiting: [], standIns: [], projects: [], lanes: [], cells: [], shown: [], addChooser } as unknown as WindowBag;
  const { container, unmount } = await mount(createElement(WindowStoreProvider, { store: bag, children: createElement(WindowContent) }), doc);
  expect(container.textContent).toContain("No session yet.");
  const button = find(container, (n) => n.localName === "button" && n.textContent.trim() === "New session")[0];
  expect(button, "the empty Board has a New session button").toBeDefined();
  await click(container, button);
  await settle();
  expect(addChooser).toHaveBeenCalledTimes(1);
  await unmount();
});
