// T-747 (DT-C183): Escape takes a shown tip away without consuming the key, and a keyboard focus's
// aria-describedby is removed when that focus leaves.
import { createElement } from "react";
import { expect, test } from "vitest";
import { fire, installDom, mount, settle } from "../tasks/fakeDom";
import Tip from "./Tip";

const target = (tip: string) => {
  const attrs: Record<string, string> = {};
  const el = {
    dataset: { tip },
    matches: (q: string) => q == ":focus-visible",
    closest: (q: string) => (q == "[data-tip]" ? el : null),
    hasAttribute: (k: string) => k in attrs,
    setAttribute: (k: string, v: string) => void (attrs[k] = v),
    removeAttribute: (k: string) => void delete attrs[k],
    getBoundingClientRect: () => ({ left: 10, width: 20, bottom: 30 }),
  };
  return { el, attrs };
};

test("T-747: Escape hides a keyboard tip, leaves the key to others, and focus leaving clears the attribute", async () => {
  const { doc, win } = installDom();
  win.setTimeout = setTimeout;
  win.innerWidth = 800;
  const { container } = await mount(createElement(Tip), doc);

  const key = target("Close the tab");
  await fire(doc, "focusin", key.el as never);
  await settle();
  expect(container.textContent).toBe("Close the tab");
  expect(key.attrs["aria-describedby"]).toBe("kolux-tip");

  await fire(doc, "keydown", container, { key: "a" });
  await settle();
  expect(container.textContent).toBe("Close the tab");
  let used = false;
  await fire(doc, "keydown", container, { key: "Escape", preventDefault: () => (used = true), stopPropagation: () => (used = true) });
  await settle();
  expect(container.textContent).toBe("");
  expect(used).toBe(false);
  expect(key.attrs["aria-describedby"]).toBe("kolux-tip");

  await fire(doc, "focusout", key.el as never);
  expect(key.attrs["aria-describedby"]).toBeUndefined();
});

test("T-747: Escape also hides a hover tip", async () => {
  const { doc, win } = installDom();
  win.setTimeout = setTimeout;
  win.innerWidth = 800;
  const { container, unmount } = await mount(createElement(Tip), doc);
  await fire(doc, "mouseover", target("Split right").el as never);
  await settle(260);
  expect(container.textContent).toBe("Split right");
  await fire(doc, "keydown", container, { key: "Escape" });
  await settle();
  expect(container.textContent).toBe("");
  await unmount();
  for (const t of ["mouseover", "focusin", "focusout", "keydown", "mousedown", "scroll"]) expect(doc.listeners[t] ?? []).toEqual([]);
});

test("T-747: a focused element's own aria-describedby is neither replaced nor removed", async () => {
  const { doc, win } = installDom();
  win.setTimeout = setTimeout;
  win.innerWidth = 800;
  await mount(createElement(Tip), doc);
  const own = target("Usage");
  own.attrs["aria-describedby"] = "usage-help";
  await fire(doc, "focusin", own.el as never);
  await settle();
  await fire(doc, "focusout", own.el as never);
  expect(own.attrs["aria-describedby"]).toBe("usage-help");
});
