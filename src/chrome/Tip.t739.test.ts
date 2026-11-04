// T-739 (DT-C175): a keyboard focus on an element with data-tip shows its tip at once and points the element's
// aria-describedby at it; a click's focus (not focus-visible) shows nothing, and focus on an element without a
// tip hides it.
import { createElement } from "react";
import { expect, test } from "vitest";
import { fire, installDom, mount, settle } from "../tasks/fakeDom";
import Tip from "./Tip";

const target = (tip: string | null, visible: boolean) => {
  const attrs: Record<string, string> = {};
  const el = {
    dataset: tip ? { tip } : {},
    matches: (q: string) => q == ":focus-visible" && visible,
    closest: (q: string) => (q == "[data-tip]" && tip ? el : null),
    setAttribute: (k: string, v: string) => void (attrs[k] = v),
    getBoundingClientRect: () => ({ left: 10, width: 20, bottom: 30 }),
  };
  return { el, attrs };
};

test("T-739: a keyboard focus shows the tip and describes the element by it; a click focus does not", async () => {
  const { doc, win } = installDom();
  win.setTimeout = setTimeout;
  win.innerWidth = 800;
  const { container } = await mount(createElement(Tip), doc);

  const click = target("Close the tab", false);
  await fire(doc, "focusin", click.el as never);
  await settle();
  expect(container.textContent).toBe("");
  expect(click.attrs["aria-describedby"]).toBeUndefined();

  const key = target("Close the tab", true);
  await fire(doc, "focusin", key.el as never);
  await settle();
  expect(container.textContent).toBe("Close the tab");
  expect(key.attrs["aria-describedby"]).toBe("kolux-tip");

  await fire(doc, "focusin", target(null, true).el as never);
  await settle();
  expect(container.textContent).toBe("");
});

test("T-739: the mouse path is unchanged: hovering shows the tip only after the delay and sets no attribute", async () => {
  const { doc, win } = installDom();
  win.setTimeout = setTimeout;
  win.innerWidth = 800;
  const { container } = await mount(createElement(Tip), doc);
  const hover = target("Close the tab", false);
  await fire(doc, "mouseover", hover.el as never);
  await settle(20);
  expect(container.textContent).toBe("");
  await settle(260);
  expect(container.textContent).toBe("Close the tab");
  expect(hover.attrs["aria-describedby"]).toBeUndefined();
});
