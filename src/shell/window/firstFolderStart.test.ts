// Job 57 F1, job 68 F1: the first folder added after setup opens the Start form once, even when the folder in
// front is its project's stored folder spelled another way (8.3 name, subst drive, link).
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
  let front = (_dir: string) => {};
  function Host() {
    const [firstStart, setFirstStart] = useState<string | null>(c.firstStart);
    const [activeDir, setActiveDir] = useState(c.activeDir);
    front = setActiveDir;
    const [n, setN] = useState(0);
    redraw = () => setN(n + 1);
    const bag = {
      firstStart,
      doneFirstStart: () => setFirstStart(null),
      activeDir,
      projects: [{ id: "p1", name: "App", path: c.projectPath }],
      owner: { [c.ownerDir]: "p1" },
      openStart,
      tick: n,
    } as unknown as WindowBag;
    return createElement(WindowStoreProvider, { store: bag, children: createElement(FirstFolderStart) });
  }
  const { unmount } = await mount(createElement(Host), doc);
  await settle();
  return { openStart, redraw: () => act(async () => redraw()), front: (dir: string) => act(async () => front(dir)), unmount };
}

test("F1: the project's stored folder is spelled apart from the opened one (8.3 name, subst, link) and is in front: the Start form opens once", async () => {
  // Job 68: the real store puts the project's own folder in front (gridOf of the opened worktree), not firstStart.
  const d = await draw({ firstStart: "C:\\w\\app", activeDir: "C:\\w\\APP~1", projectPath: "C:\\w\\APP~1", ownerDir: "C:\\w\\app" });
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
  // Job 68 F5: the user then brings the added folder to the front: the form was dropped, so it stays off.
  await d.front("C:\\w\\app");
  await settle();
  expect(d.openStart).not.toHaveBeenCalled();
  await d.unmount();
});
