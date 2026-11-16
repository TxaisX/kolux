// R61-05: the Find box of a pane that is not in front. The bar stops the mouse-down from reaching the pane (so the
// terminal under it does not take the click), so it hands the pane its focus itself first: a closing key pressed next
// then acts on this pane, not on the one that was in front. The real FindBar on the small DOM.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeNode, byLabel, fire, installDom, mount } from "../tasks/fakeDom";

let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  (FakeNode.prototype as unknown as { select?: () => void }).select ??= () => {}; // the bar selects its query on open
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("R61-05: a mouse-down in the Find box focuses its own pane, and still does not reach the pane's own handler", async () => {
  const { doc } = installDom();
  const { default: FindBar } = await import("./FindBar");
  const onFocus = vi.fn();
  const paneDown = vi.fn();
  const bar = createElement(FindBar, { count: 0, current: -1, onSearch: () => {}, onStep: () => {}, onClose: () => {}, onFocus });
  const m = await mount(createElement("section", { onMouseDown: paneDown }, bar), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await fire(c, "mousedown", byLabel(c, "input", "Find")[0]);
  expect(onFocus).toHaveBeenCalledTimes(1);
  expect(paneDown).not.toHaveBeenCalled();
});
