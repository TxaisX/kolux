// @vitest-environment happy-dom
// SESS-001 / UX audit F1 on a real DOM: the plus menu is a src/ui Popover named "New session" at the caller's fixed
// numbers; focus starts in the search box, Escape first clears a search that holds text and then closes the menu,
// the arrow keys walk the buttons, and a press outside closes it.
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import PlusMenu, { type AgentInfo } from "./PlusMenu";
import { byLabel, fire, installDom, mount, settle, typeInto, until } from "../tasks/realDom";

const agent = (id: string, name: string): AgentInfo => ({ id, name, program: id, args: [], installed: true, path: `/bin/${id}` });
const agents = [agent("claude", "Claude Code"), agent("codex", "Codex"), agent("grok", "Grok"), agent("gemini", "Gemini CLI")];

let unmount: () => Promise<void> = async () => {};
beforeEach(() => installDom());
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("SESS-001: the plus menu is a popover at fixed numbers; Escape clears the search, then closes; arrows walk the rows", async () => {
  const closed = vi.fn();
  function Page() {
    const [open, setOpen] = useState(true);
    return open ? createElement(PlusMenu, { agents, defaultId: "claude", onPick: () => {}, onClose: () => (closed(), setOpen(false)), style: { top: 40, right: 8 } }) : null;
  }
  const m = await mount(createElement(Page));
  unmount = m.unmount;
  const c = m.container;
  await until(() => byLabel(c, "div", "New session").length === 1, "the plus menu");
  const box = byLabel(c, "div", "New session")[0];
  expect(box.getAttribute("role")).toBe("dialog");
  expect(box.getAttribute("data-testid")).toBe("new-session-menu");
  expect(box.className).toBe("menu");
  const at = box.parentElement.style;
  expect([at.top, at.right, at.transform]).toEqual(["40px", "8px", "none"]);
  const search = byLabel(c, "input", "Search agents")[0];
  await until(() => document.activeElement === search, "focus in the search box");

  await typeInto(c, search, "cod");
  await fire(c, "keydown", search, { key: "Escape" });
  await settle();
  expect(search.value, "the first Escape clears the search").toBe("");
  expect(closed).not.toHaveBeenCalled();

  const rows = () => [...box.querySelectorAll("button:not(:disabled)")] as HTMLElement[];
  rows()[0].focus();
  await fire(c, "keydown", rows()[0], { key: "ArrowDown" });
  expect(document.activeElement).toBe(rows()[1]);

  await fire(c, "keydown", document.activeElement ?? document.body, { key: "Escape" });
  await settle();
  expect(closed).toHaveBeenCalledTimes(1);
});

test("SESS-001: a press outside the plus menu closes it", async () => {
  const closed = vi.fn();
  // On the page before the menu opens (Base UI leaves alone a press on an element added after it opened).
  const outside = document.createElement("button");
  document.body.appendChild(outside);
  const m = await mount(createElement(PlusMenu, { agents, onPick: () => {}, onClose: closed, style: { left: 16, bottom: 56 } }));
  unmount = m.unmount;
  const c = m.container;
  await until(() => byLabel(c, "div", "New session").length === 1, "the plus menu");
  // The press as a mouse sends it: down, up, then the click (Base UI reads a whole press outside, not a drag out).
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) await act(async () => void outside.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
  await act(async () => outside.click());
  await settle();
  expect(closed).toHaveBeenCalled();
});
