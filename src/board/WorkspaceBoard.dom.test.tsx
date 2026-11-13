// @vitest-environment happy-dom
// PROJ-085 / VIEW-026 on a real DOM: the workspace board is a src/ui Dialog named "Workspace statuses" with the
// ws-board class (never the Board screen's .board), its search starts empty, a card's Move to list is a menu of the
// lanes, a picked lane moves the card without selecting it, and the first Escape closes only the list.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const calls: [string, unknown][] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    if (cmd === "project_list") return [{ id: "p1", name: "alpha", path: "C:/w/alpha" }];
    if (cmd === "workspace_list") return [{ path: "C:/w/alpha/1", branch: "feat/1", head: "abc", isMain: false }];
    if (cmd === "workspace_statuses") return { list: [{ id: "todo", label: "To do" }, { id: "review", label: "In review" }], of: ["todo"] };
    return null;
  }),
}));

import WorkspaceBoard from "./WorkspaceBoard";
import { byLabel, byText, click, find, fire, installDom, mount, settle, until, type FakeNode } from "../tasks/realDom";

let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  installDom();
  calls.length = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const press = (c: FakeNode, key: string) => fire(c, "keydown", document.activeElement ?? document.body, { key });

test("PROJ-085 / VIEW-026: the board is a ws-board dialog; Move to is a menu, and Escape closes the list before the board", async () => {
  const onClose = vi.fn();
  const m = await mount(createElement(WorkspaceBoard, { onClose }));
  unmount = m.unmount;
  const c = m.container;
  const board = byLabel(c, "div", "Workspace statuses")[0];
  expect(board.getAttribute("role")).toBe("dialog");
  expect(board.getAttribute("aria-modal")).toBe("true");
  expect(board.classList.contains("ws-board")).toBe(true);
  expect(board.classList.contains("board")).toBe(false);
  expect(byLabel(c, "input", "Search workspace statuses")[0].value, "the search starts empty").toBe("");
  await until(() => document.activeElement === board, "focus on the board itself, as before");

  await until(() => byText(c, "button", "Move").length === 1, "the card");
  await click(c, byText(c, "button", "Move")[0]);
  await until(() => byLabel(c, "div", "Move to").length === 1, "the Move to list");
  const list = byLabel(c, "div", "Move to")[0];
  expect(list.getAttribute("role")).toBe("menu");
  const rows = find(list, (n) => n.getAttribute("role") === "menuitem");
  expect(rows.map((r: FakeNode) => r.textContent)).toEqual(["To do", "In review"]);
  expect(rows[0].hasAttribute("disabled") || rows[0].getAttribute("aria-disabled") === "true", "the card's own lane is off").toBe(true);

  // The first Escape closes only the list; the board stays.
  await press(c, "Escape");
  await settle();
  expect(byLabel(c, "div", "Move to")).toHaveLength(0);
  expect(onClose).not.toHaveBeenCalled();

  // A picked lane moves the card and leaves the selection alone (the list sits outside the card).
  await click(c, byText(c, "button", "Move")[0]);
  await until(() => byLabel(c, "div", "Move to").length === 1, "the Move to list again");
  await click(c, byText(c, "button", "In review")[0]);
  await until(() => calls.some(([cmd]) => cmd === "workspace_status_set"), "the move");
  expect(calls.find(([cmd]) => cmd === "workspace_status_set")?.[1]).toEqual({ path: "C:/w/alpha/1", status: "review" });
  expect(find(c, (n) => n.localName === "article" && n.hasAttribute("data-selected"))).toHaveLength(0);

  // With no list open, Escape closes the board.
  await settle();
  await press(c, "Escape");
  expect(onClose).toHaveBeenCalledTimes(1);
});
