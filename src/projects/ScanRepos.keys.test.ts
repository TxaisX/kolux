// @vitest-environment happy-dom
// T-738 / T-764 (#179) on a real DOM: the Scan-folder dialog (a src/ui Dialog) takes the keyboard when it opens (its
// folder field), keeps Tab inside, closes on Escape wherever focus is in it, and gives focus back to the control that
// opened it.
import { createElement, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { byText, click, find, fire, installDom, mount, settle, until, type FakeNode } from "../tasks/realDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject("not stubbed") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

let unmount: () => Promise<void> = async () => {};
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function open() {
  installDom();
  const closed = vi.fn();
  const { default: ScanRepos } = await import("./ScanRepos");
  function Page() {
    const [shown, setShown] = useState(false);
    return createElement(
      "div",
      null,
      createElement("button", { id: "opener", onClick: () => setShown(true) }, "Scan a folder"),
      shown && createElement(ScanRepos, { root: "C:/code", onClose: () => (closed(), setShown(false)), onDone: () => {}, onProblem: () => {} }),
    );
  }
  const m = await mount(createElement(Page));
  unmount = m.unmount;
  const c = m.container as FakeNode;
  const opener = find(c, (n) => n.id === "opener")[0];
  opener.focus();
  await click(c, opener);
  await until(() => find(c, (n) => n.getAttribute("aria-label") === "Scan a folder for repositories").length === 1, "the dialog");
  const box = find(c, (n) => n.getAttribute("aria-label") === "Scan a folder for repositories")[0];
  return { c, box, opener, closed };
}

test("T-738: opening Scan a folder puts focus on its folder field; closing it gives focus back to the opener", async () => {
  const { c, box, opener, closed } = await open();
  expect(box.getAttribute("role")).toBe("dialog");
  expect(box.getAttribute("aria-modal")).toBe("true");
  const field = find(box, (n) => n.getAttribute("aria-label") === "folder to scan")[0];
  await until(() => document.activeElement === field, "focus on the folder field");
  await click(c, byText(box, "button", "Cancel")[0]);
  expect(closed).toHaveBeenCalledTimes(1);
  await until(() => document.activeElement === opener, "focus back on the opener");
});

test("T-738: Tab stays inside the dialog: focus guards on both sides, the page behind out of reach", async () => {
  const { c, box, opener } = await open();
  expect(find(c, (n) => n.hasAttribute("data-base-ui-focus-guard")).length).toBeGreaterThanOrEqual(2);
  expect(opener.closest("[inert],[aria-hidden='true']"), "the page behind is out of reach").not.toBeNull();
  expect(box.contains(document.activeElement)).toBe(true);
});

test("T-738: Escape closes the Scan dialog while focus is on a button inside it, and stops there", async () => {
  const terminal = vi.fn();
  window.addEventListener("keydown", terminal);
  const { c, box, closed } = await open();
  const cancel = byText(box, "button", "Cancel")[0];
  cancel.focus();
  await fire(c, "keydown", cancel, { key: "Escape" });
  await settle();
  expect(closed).toHaveBeenCalledTimes(1);
  expect(terminal).not.toHaveBeenCalled();
  window.removeEventListener("keydown", terminal);
});
