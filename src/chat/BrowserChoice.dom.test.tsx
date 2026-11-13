// @vitest-environment happy-dom
// CHAT-025 (T-329) on a real DOM: a plain click on a web link opens "Open link in", a src/ui menu at the pointer with
// the chat's own look (chat-browser-menu, rows without Kolux's .menu-item); the system browser row asks for it and
// focus goes back on the link, and Escape closes the menu with focus back on the link too.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { BrowserChoice } from "./ChatText";
import { byLabel, byText, click, find, fire, installDom, mount, settle, until, type FakeNode } from "../tasks/realDom";

let unmount: () => Promise<void> = async () => {};
beforeEach(() => installDom());
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

function page(onPick: (where: "kolux" | "system") => boolean, closed: () => void) {
  return function Page() {
    const [open, setOpen] = useState(false);
    return createElement(
      "div",
      null,
      createElement("a", { id: "link", href: "#", tabIndex: 0, onClick: (e: { preventDefault: () => void }) => (e.preventDefault(), setOpen(true)) }, "example.com"),
      open && createElement(BrowserChoice, { url: "https://example.com/", at: { x: 40, y: 50 }, onPick: (w: "kolux" | "system") => (setOpen(false), onPick(w)), onClose: () => (closed(), setOpen(false)) }),
    );
  };
}

test("CHAT-025: the choice is a menu with the chat's look; its first row asks for the system browser and focus returns to the link", async () => {
  const onPick = vi.fn(() => false);
  const m = await mount(createElement(page(onPick, () => {})));
  unmount = m.unmount;
  const c = m.container;
  const link = find(c, (n) => n.id === "link")[0];
  link.focus();
  await click(c, link);
  await until(() => byLabel(c, "div", "Open link in").length === 1, "the browser choice");
  const menu: FakeNode = byLabel(c, "div", "Open link in")[0];
  expect(menu.getAttribute("role")).toBe("menu");
  expect(menu.classList.contains("chat-browser-menu")).toBe(true);
  expect(menu.classList.contains("menu")).toBe(false);
  const rows = find(menu, (n) => n.getAttribute("role") === "menuitem");
  expect(rows.map((r: FakeNode) => r.textContent?.trim())).toEqual(["Open in your browser", "Cancel"]);
  expect(rows.some((r: FakeNode) => r.classList.contains("menu-item"))).toBe(false);
  await until(() => document.activeElement === rows[0], "focus on the first choice");
  await click(c, byText(menu, "button", "Open in your browser")[0]);
  await settle();
  expect(onPick).toHaveBeenCalledWith("system");
  expect(byLabel(c, "div", "Open link in")).toHaveLength(0);
  await until(() => document.activeElement === link, "focus back on the link after the system browser opened");
});

test("CHAT-025: Escape closes the choice and focus goes back to the link", async () => {
  const closed = vi.fn();
  const m = await mount(createElement(page(() => false, closed)));
  unmount = m.unmount;
  const c = m.container;
  const link = find(c, (n) => n.id === "link")[0];
  link.focus();
  await click(c, link);
  await until(() => byLabel(c, "div", "Open link in").length === 1, "the browser choice");
  await fire(c, "keydown", document.activeElement ?? document.body, { key: "Escape" });
  await settle();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(byLabel(c, "div", "Open link in")).toHaveLength(0);
  await until(() => document.activeElement === link, "focus back on the link");
});
