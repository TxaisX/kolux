// T-729: ResetButton and ConfirmClear ask in the shared Ask dialog (role=alertdialog, aria-label = the question).
import { createElement } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, installDom, mount } from "../tasks/fakeDom";
import { ResetButton } from "./SafetyRules";
import ConfirmClear from "../shell/ConfirmClear";

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installDom().doc;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});
const show = async (el: ReturnType<typeof createElement>) => {
  const m = await mount(el, doc);
  unmount = m.unmount;
  return m.container;
};
const dialog = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog")[0];

test("a reset button opens the Ask titled with its question; the confirm word loses 'Yes, '; Keep backs out", async () => {
  const log: string[] = [];
  const c = await show(createElement(ResetButton, { label: "Forget", ariaLabel: "Forget MiniMax API key", yes: "Yes, forget", onReset: () => log.push("reset") }));
  expect(dialog(c)).toBeUndefined();
  await click(c, find(c, (n) => n.attrs["data-reset"] !== undefined)[0]);
  const ask = dialog(c);
  expect(ask.attrs["aria-label"]).toBe("Forget MiniMax API key?");
  expect(byText(ask, "button", "Forget")).toHaveLength(1);
  expect(byText(ask, "button", "Keep")).toHaveLength(1);
  await click(c, byText(ask, "button", "Keep")[0]);
  expect(dialog(c)).toBeUndefined();
  expect(log).toEqual([]);
});

test("the confirm resets once and closes; the default words are Reset and Keep", async () => {
  const log: string[] = [];
  const c = await show(createElement(ResetButton, { label: "Reset this project's rules", onReset: () => log.push("reset") }));
  await click(c, find(c, (n) => n.localName === "button")[0]);
  expect(dialog(c).attrs["aria-label"]).toBe("Reset this project's rules?");
  await click(c, byText(dialog(c), "button", "Reset")[0]);
  expect(log).toEqual(["reset"]);
  expect(dialog(c)).toBeUndefined();
});

test("clearing several notes asks in the Ask; Clear drops them, Keep does not; one note clears at once", async () => {
  const log: string[] = [];
  const c = await show(createElement(ConfirmClear, { count: 3, where: "a.ts", onConfirm: () => log.push("clear"), children: "Clear all" }));
  await click(c, byText(c, "button", "Clear all")[0]);
  expect(dialog(c).attrs["aria-label"]).toContain("3");
  await click(c, byText(dialog(c), "button", "Keep")[0]);
  expect(dialog(c)).toBeUndefined();
  expect(log).toEqual([]);
  await click(c, byText(c, "button", "Clear all")[0]);
  await click(c, byText(dialog(c), "button", "Clear")[0]);
  expect(log).toEqual(["clear"]);
  expect(dialog(c)).toBeUndefined();
  await unmount();
  const c1 = await show(createElement(ConfirmClear, { count: 1, onConfirm: () => log.push("one"), children: "Clear all" }));
  await click(c1, byText(c1, "button", "Clear all")[0]);
  expect(dialog(c1)).toBeUndefined();
  expect(log).toEqual(["clear", "one"]);
});
