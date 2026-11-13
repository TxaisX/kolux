// @vitest-environment happy-dom
// EDIT-011 (T-234-b) on a real DOM: a right-click on a table cell opens the "Table" cell menu (a src/ui context menu
// with the table-ctx look); a row that cannot act says why, a picked row runs its edit and closes the menu, and Escape
// closes it without an edit.
import { createElement } from "react";
import type { LexicalEditor } from "lexical";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const edits: unknown[] = [];
let table: HTMLTableElement;
vi.mock("./richTable", () => ({ tablesOf: () => [{ key: "t1", el: table }], runTableEdit: (_e: unknown, edit: unknown) => (edits.push(edit), true) }));

import TableControls from "./TableControls";
import { byLabel, byText, click, find, fire, installDom, mount, settle, until, type FakeNode } from "../tasks/realDom";

let unmount: () => Promise<void> = async () => {};
let root: HTMLDivElement;
beforeEach(() => {
  installDom();
  edits.length = 0;
  root = document.createElement("div");
  root.innerHTML = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";
  document.body.appendChild(root);
  table = root.querySelector("table")!;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const editor = () => ({ getRootElement: () => root }) as unknown as LexicalEditor;
const openOn = (c: FakeNode, cell: Element) => fire(c, "contextmenu", cell, { clientX: 50, clientY: 60 });

test("EDIT-011: the cell menu is a Table menu; a header cell's Delete row is off and says why; a row runs and closes", async () => {
  const m = await mount(createElement(TableControls, { editor: editor() }));
  unmount = m.unmount;
  const c = m.container;
  await openOn(c, root.querySelector("th")!);
  await until(() => byLabel(c, "div", "Table").length === 1, "the cell menu");
  const menu: FakeNode = byLabel(c, "div", "Table")[0];
  expect(menu.getAttribute("role")).toBe("menu");
  expect(menu.classList.contains("table-ctx")).toBe(true);
  const rows = find(menu, (n) => n.getAttribute("role") === "menuitem");
  expect(rows.map((r: FakeNode) => r.textContent)).toEqual(["Row above", "Row below", "Delete row", "Column left", "Column right", "Delete column"]);
  expect(rows.every((r: FakeNode) => r.classList.contains("table-ctx-item"))).toBe(true);
  const del = rows[2];
  expect(del.getAttribute("aria-disabled")).toBe("true");
  expect(del.getAttribute("title")).toMatch(/header row/);

  await click(c, byText(menu, "button", "Column right")[0]);
  await settle();
  expect(edits).toEqual([{ kind: "col-add", table: "t1", at: 1 }]);
  expect(byLabel(c, "div", "Table")).toHaveLength(0);
});

test("EDIT-011: Escape closes the cell menu without an edit", async () => {
  const m = await mount(createElement(TableControls, { editor: editor() }));
  unmount = m.unmount;
  const c = m.container;
  await openOn(c, root.querySelector("td")!);
  await until(() => byLabel(c, "div", "Table").length === 1, "the cell menu");
  await fire(c, "keydown", document.activeElement ?? document.body, { key: "Escape" });
  await settle();
  expect(byLabel(c, "div", "Table")).toHaveLength(0);
  expect(edits).toEqual([]);
});
