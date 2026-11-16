// Job 57 F1: the first folder added after setup opens the Start form once, even when the added folder is a
// subfolder of a repository (openedWorktree falls back to the main checkout) or is spelled another way.
// FirstFolderStart is drawn under the window store; doneFirstStart clears firstStart as the real store does.
import { act, createElement, useState } from "react";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
import { installDom, mount, settle } from "../../tasks/fakeDom";
import type { WindowBag } from "../windowBag";
import { WindowStoreProvider } from "./store";

type Case = { firstStart: string; activeDir: string; projectPath: string; ownerDir: string };

async function draw(c: Case) {
  const { doc, win } = installDom();
  Object.assign(win, { setTimeout, clearTimeout, setInterval, clearInterval });
  const { FirstFolderStart } = await import("./Hosts");
  const openStart = vi.fn();
  let redraw = () => {};
  function Host() {
    const [firstStart, setFirstStart] = useState<string | null>(c.firstStart);
    const [n, setN] = useState(0);
    redraw = () => setN(n + 1);
    const bag = {
      firstStart,
      doneFirstStart: () => setFirstStart(null),
      activeDir: c.activeDir,
      projects: [{ id: "p1", name: "App", path: c.projectPath }],
      owner: { [c.ownerDir]: "p1" },
      openStart,
      tick: n,
    } as unknown as WindowBag;
    return createElement(WindowStoreProvider, { store: bag, children: createElement(FirstFolderStart) });
  }
  const { unmount } = await mount(createElement(Host), doc);
  await settle();
  return { openStart, redraw: () => act(async () => redraw()), unmount };
}

test("F1: a subfolder of a repository (path is not the opened worktree) opens the Start form once", async () => {
  const d = await draw({ firstStart: "C:\\w\\app", activeDir: "C:\\w\\app", projectPath: "C:\\w\\app\\web", ownerDir: "C:\\w\\app" });
  expect(d.openStart).toHaveBeenCalledTimes(1);
  expect(d.openStart).toHaveBeenCalledWith({ here: true });
  await d.redraw();
  await settle();
  expect(d.openStart, "not again on a second draw").toHaveBeenCalledTimes(1);
  await d.unmount();
});

test("F1: the same folder spelled another way (C:/w/App/ against c:\\w\\app) opens the Start form once", async () => {
  const d = await draw({ firstStart: "c:\\w\\app", activeDir: "C:/w/App/", projectPath: "C:/w/App/", ownerDir: "C:/w/App/" });
  expect(d.openStart).toHaveBeenCalledTimes(1);
  await d.redraw();
  await settle();
  expect(d.openStart, "not again on a second draw").toHaveBeenCalledTimes(1);
  await d.unmount();
});

test("F1: the user is on another folder once the added one is on the list: no form, and it stays off", async () => {
  const d = await draw({ firstStart: "C:\\w\\app", activeDir: "C:\\w\\other", projectPath: "C:\\w\\app", ownerDir: "C:\\w\\app" });
  expect(d.openStart).not.toHaveBeenCalled();
  await d.unmount();
});
