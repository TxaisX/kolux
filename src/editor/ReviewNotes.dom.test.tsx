// @vitest-environment happy-dom
// EDIT-020 on a real DOM: the "Add review note" box is a src/ui Dialog that is not modal, under the picked text: focus
// starts in the note, a press in the editor leaves it open, Add note hands the note over, and Escape drops it.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ReviewNotes from "./ReviewNotes";
import type { Picked } from "./notes";
import { byLabel, byText, click, fire, installDom, mount, settle, typeInto, until } from "../tasks/realDom";

const picked = { draft: { path: "C:/w/a.ts", line: 3, quote: "const a = 1;" }, x: 40, y: 60 } as unknown as Picked;

let unmount: () => Promise<void> = async () => {};
beforeEach(() => installDom());
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const tray = (onAdd: (n: unknown) => void, onCancel: () => void) =>
  createElement(ReviewNotes, { picked, notes: [], onAdd, onCancel, onRemove: () => {}, onClear: () => {}, targets: [], menu: false, onMenu: () => {}, onSend: async () => null });

test("EDIT-020: the note box is non-modal; focus starts in the note, a press outside keeps it, Add note adds, Escape cancels", async () => {
  const editor = document.createElement("div");
  editor.tabIndex = 0;
  document.body.appendChild(editor);
  const onAdd = vi.fn();
  const onCancel = vi.fn();
  const m = await mount(tray(onAdd, onCancel));
  unmount = m.unmount;
  const c = m.container;
  await until(() => byLabel(c, "div", "Add review note").length === 1, "the note box");
  const box = byLabel(c, "div", "Add review note")[0];
  expect(box.getAttribute("role")).toBe("dialog");
  expect(box.getAttribute("aria-modal")).toBeNull();
  expect(box.classList.contains("review-pop")).toBe(true);
  const note = byLabel(c, "textarea", "review note")[0];
  await until(() => document.activeElement === note, "focus in the note");

  await fire(c, "pointerdown", editor);
  await fire(c, "mousedown", editor);
  await fire(c, "click", editor);
  await settle();
  expect(onCancel).not.toHaveBeenCalled();

  await typeInto(c, note, "Name it better");
  await click(c, byText(box, "button", "Add note")[0]);
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect((onAdd.mock.calls[0][0] as { note: string }).note).toBe("Name it better");

  await fire(c, "keydown", document.activeElement ?? document.body, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
});
