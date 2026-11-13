// @vitest-environment happy-dom
// VIEW-116: the confirmation dialog's keys, focus order and don't-ask-again box. It is src/ui's AlertDialog (Base UI),
// drawn in a portal on the body, so it is read from a real DOM.
import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import Ask, { askKey } from "./Ask";
import { click, fire, installDom, mount, settle } from "../tasks/realDom";

let unmount: () => Promise<void> = async () => {};
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});
const show = async (p: Partial<Parameters<typeof Ask>[0]>) => {
  installDom();
  const m = await mount(createElement(Ask, { title: "Delete x?", body: "It goes for good.", confirm: "Delete", onConfirm: () => {}, onCancel: () => {}, ...p }));
  unmount = m.unmount;
  await settle(); // Base UI moves focus in on the next frame
  return document.querySelector<HTMLElement>('[role="alertdialog"]')!;
};

test("Escape always cancels and Enter on Confirm counts only on prompts that opt in", () => {
  expect(askKey("Escape", false, false)).toBe("cancel");
  expect(askKey("Escape", true, true)).toBe("cancel");
  expect(askKey("Enter", true, false)).toBe("block");
  expect(askKey("Enter", true, true)).toBe("pass");
  // Enter on Cancel (where focus starts) backs out, as the button itself does.
  expect(askKey("Enter", false, false)).toBe("pass");
  expect(askKey("a", true, false)).toBe("pass");
});

test("Cancel comes before Confirm and the don't-ask-again box starts unticked", async () => {
  const box = await show({ dontAsk: true });
  expect(box.getAttribute("aria-label")).toBe("Delete x?");
  expect(box.getAttribute("aria-modal")).toBe("true");
  expect(box.className).toBe("ask");
  expect(box.parentElement!.className).toBe("ask-backdrop");
  const html = box.innerHTML;
  expect(html.indexOf(">Cancel<")).toBeLessThan(html.indexOf(">Delete<"));
  expect(box.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  expect(box.textContent).toContain("Don't ask again");
  await unmount();
  expect((await show({})).querySelector('input[type="checkbox"]')).toBeNull();
});

test("the dialog traps focus: Cancel is the control that gets focus, and Escape runs Cancel and stops there", async () => {
  const onCancel = vi.fn();
  const terminal = vi.fn();
  window.addEventListener("keydown", terminal);
  const box = await show({ onCancel });
  expect(document.activeElement!.textContent).toBe("Cancel");
  await fire(box, "keydown", document.activeElement!, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(terminal).not.toHaveBeenCalled();
  window.removeEventListener("keydown", terminal);
});

test("Enter on Delete does nothing unless the prompt opts in", async () => {
  const onConfirm = vi.fn();
  const box = await show({ onConfirm });
  const del = [...box.querySelectorAll("button")].find((b) => b.textContent === "Delete")!;
  del.focus();
  let blocked = false;
  await fire(box, "keydown", del, { key: "Enter", preventDefault: () => (blocked = true) });
  expect(blocked).toBe(true);
  await click(box, del);
  expect(onConfirm).toHaveBeenCalledWith(false);
});

test("with no confirm word it only explains, with a single OK that closes", async () => {
  const onCancel = vi.fn();
  const box = await show({ confirm: null, onCancel });
  expect([...box.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["OK"]);
  await click(box, box.querySelector("button")!);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

// C28-R1-01: a removal in flight cannot be backed out of, so the question greys Keep and says so to a reader.
test("a locked question greys its back-out, ignores Escape, and still offers the confirm", async () => {
  const onCancel = vi.fn();
  const locked = await show({ confirm: "Deleting…", cancel: "Keep", locked: true, onCancel });
  expect(locked.innerHTML).toContain('aria-disabled="true"');
  expect(locked.innerHTML).toContain(">Deleting…</button>"); // a prompt whose own operation can finish keeps its confirm
  await fire(locked, "keydown", document.activeElement!, { key: "Escape" });
  expect(onCancel).not.toHaveBeenCalled();
  await unmount();
  expect((await show({ cancel: "Keep" })).innerHTML).not.toContain("aria-disabled");
});
