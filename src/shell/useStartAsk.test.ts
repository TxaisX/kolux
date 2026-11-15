// Job 13 F4: the Start form's ask at open never jumps up over work. A first agent search that failed, or a user who
// has already started something, counts as answered; a later good search does not bring the form up. It also waits
// for the first-run state, which arrives from an async read (job 11 D-15). F5: a webview reload does not ask again.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { installDom } from "../tasks/fakeDom";
import { askAtOpen } from "../launch/startForm";

import { isFirstWindow, resetStartAsk, useStartAsk } from "./useStartAsk";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mount: () => Root;
beforeAll(async () => {
  const { doc } = installDom();
  const { createRoot } = await import("react-dom/client");
  mount = () => createRoot(doc.createElement("div") as unknown as Element);
});
beforeEach(() => resetStartAsk());

test("Start form D: outside Tauri there is one window, so it counts as the first", () => {
  expect(isFirstWindow()).toBe(true);
});

const w = { on: true, firstWindow: true, asked: false, settingsRead: true, agentsDone: true, projectsRead: true, launching: false, sheetOpen: false, firstRunKnown: true };

test("F4: a failed first search or a user who moved on counts as answered; the first-run state is waited for", () => {
  expect(askAtOpen(w)).toBe("ask");
  expect(askAtOpen({ ...w, agentsDone: false, agentsFailed: true })).toBe("skip");
  expect(askAtOpen({ ...w, agentsDone: false, userActed: true })).toBe("skip");
  expect(askAtOpen({ ...w, firstRunKnown: false })).toBe("wait");
  expect(askAtOpen({ ...w, firstRunKnown: false, firstRun: true })).toBe("skip");
});

type In = Parameters<typeof useStartAsk>[0];
function Probe(p: In) {
  useStartAsk(p);
  return null;
}
const base = (open: () => void): In => ({ settings: {}, settingsRead: true, agentsDone: false, projectsRead: true, launching: false, sheetOpen: false, firstRun: false, firstRunKnown: true, agentsFailed: false, panes: 2, open });

test("F4: the first search fails, a later search works: the form does not come up", () => {
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, base(open))));
  act(() => root.render(createElement(Probe, { ...base(open), agentsFailed: true })));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true })));
  expect(open).not.toHaveBeenCalled();
  act(() => root.unmount());
});

test("F4: a pane added while the search runs, or a launch that ended: the form does not come up later", () => {
  for (const moved of [{ panes: 3 }, { launching: true }]) {
    resetStartAsk();
    const open = vi.fn();
    const root = mount();
    act(() => root.render(createElement(Probe, base(open))));
    act(() => root.render(createElement(Probe, { ...base(open), ...moved })));
    act(() => root.render(createElement(Probe, { ...base(open), ...moved, launching: false, agentsDone: true })));
    expect(open).not.toHaveBeenCalled();
    act(() => root.unmount());
  }
});

test("F4: the form waits for the first-run state, then asks once", () => {
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, firstRunKnown: false })));
  expect(open).not.toHaveBeenCalled();
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, firstRunKnown: true })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, panes: 4 })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});
