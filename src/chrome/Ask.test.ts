// VIEW-116: the confirmation dialog's keys, focus order and don't-ask-again box.
import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import Ask, { askKey } from "./Ask";

test("Escape always cancels and Enter on Confirm counts only on prompts that opt in", () => {
  expect(askKey("Escape", false, false)).toBe("cancel");
  expect(askKey("Escape", true, true)).toBe("cancel");
  expect(askKey("Enter", true, false)).toBe("block");
  expect(askKey("Enter", true, true)).toBe("pass");
  // Enter on Cancel (where focus starts) backs out, as the button itself does.
  expect(askKey("Enter", false, false)).toBe("pass");
  expect(askKey("a", true, false)).toBe("pass");
});

test("Cancel comes before Confirm and the don't-ask-again box starts unticked", () => {
  const noop = () => {};
  const html = renderToString(createElement(Ask, { title: "Delete x?", body: "It goes for good.", confirm: "Delete", dontAsk: true, onConfirm: noop, onCancel: noop }));
  expect(html).toContain('role="alertdialog"');
  expect(html.indexOf(">Cancel<")).toBeLessThan(html.indexOf(">Delete<"));
  expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*>/);
  expect(html).toContain("Don&#x27;t ask again");
  const plain = renderToString(createElement(Ask, { title: "Delete x?", body: "b", confirm: "Delete", onConfirm: noop, onCancel: noop }));
  expect(plain).not.toContain("checkbox");
});

// C28-R1-01: a removal in flight cannot be backed out of, so the question greys Keep and says so to a reader.
test("a locked question greys its back-out and still offers the confirm", () => {
  const noop = () => {};
  const locked = renderToString(createElement(Ask, { title: "Delete x?", body: "b", confirm: "Deleting…", cancel: "Keep", locked: true, onConfirm: noop, onCancel: noop }));
  expect(locked).toContain('aria-disabled="true"');
  expect(locked).toContain(">Deleting…</button>"); // a prompt whose own operation can finish keeps its confirm
  const free = renderToString(createElement(Ask, { title: "Delete x?", body: "b", confirm: "Delete", cancel: "Keep", onConfirm: noop, onCancel: noop }));
  expect(free).not.toContain("aria-disabled");
});
