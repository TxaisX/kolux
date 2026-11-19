// Row 401: choosing Help > About opens the About panel from the chrome layer itself (not only via App.tsx's fall-through).
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { installDom, mount, settle } from "../test/fakeDom";
import { ABOUT_EVENT } from "../shell/about";
import { helpAction } from "./chromeItems";

let menuClick: (e: { payload: { id: string } }) => void = () => {};
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: typeof menuClick) => {
    if (name === "menu-action") menuClick = cb;
    return Promise.resolve(() => {});
  },
}));

let unmount: () => void = () => {};
let doc: ReturnType<typeof installDom>["doc"];
beforeEach(() => {
  doc = installDom().doc;
});
afterEach(() => unmount());

test("help.about is a help action", () => {
  expect(helpAction("help.about")).toBe("about");
});

test("a Help > About click sends the About panel's event and never reaches the page's own handler", async () => {
  const { useMenuBar } = await import("./useChrome");
  const sent: string[] = [];
  (globalThis as unknown as { window: { dispatchEvent: (e: Event) => boolean } }).window.dispatchEvent = (e) => (sent.push(e.type), true);
  const page = vi.fn();
  const m = await mount(createElement(() => (useMenuBar({} as never, page), null)), doc);
  unmount = m.unmount;
  await settle();
  menuClick({ payload: { id: "help.about" } });
  expect(sent).toEqual([ABOUT_EVENT]);
  expect(page).not.toHaveBeenCalled();
});
