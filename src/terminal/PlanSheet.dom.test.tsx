// @vitest-environment happy-dom
// SAFE-002 on a real DOM: the plan review sheet is a src/ui Dialog that is not modal, beside a terminal that stays
// usable: it does not take focus when it opens, a press outside leaves it open, and Escape closes it (a waiting send is
// cancelled first, T-032-b).
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../editor/PreviewPane", () => ({ renderMarkdown: (md: string) => md }));

import PlanSheet from "./PlanSheet";
import { byLabel, fire, installDom, mount, settle, until } from "../tasks/realDom";

let unmount: () => Promise<void> = async () => {};
beforeEach(() => installDom());
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("SAFE-002: the sheet is non-modal, keeps focus where it was, stays open on a press outside, and Escape closes it", async () => {
  const term = document.createElement("textarea");
  document.body.appendChild(term);
  term.focus();
  const calls: string[] = [];
  const m = await mount(
    createElement(PlanSheet, { title: "Claude 1", plan: "Step one.", draft: { comments: [], note: "" }, onDraft: () => {}, onApprove: () => {}, onRequest: () => {}, onClose: () => calls.push("close"), sending: true, onCancel: () => calls.push("cancel") }),
  );
  unmount = m.unmount;
  const c = m.container;
  await until(() => byLabel(c, "div", "Review the plan for Claude 1").length === 1, "the sheet");
  const sheet = byLabel(c, "div", "Review the plan for Claude 1")[0];
  expect(sheet.getAttribute("role")).toBe("dialog");
  expect(sheet.getAttribute("aria-modal")).toBeNull();
  expect(sheet.classList.contains("plan-sheet")).toBe(true);
  await settle();
  expect(document.activeElement, "focus stays in the terminal").toBe(term);

  await fire(c, "pointerdown", term);
  await fire(c, "mousedown", term);
  await fire(c, "click", term);
  await settle();
  expect(calls).toEqual([]);

  await fire(c, "keydown", term, { key: "Escape" });
  expect(calls).toEqual(["cancel", "close"]);
});
