// T-753 (DT-C189): the Open in card itself, mounted as the page draws it. Add with a command already listed
// used to do nothing and empty both fields; now the button is off, the note names the row and the fields stay.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byLabel, byText, click, type FakeDocument, type FakeNode, find, installDom, mount, settle, typeInto } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function page(apps: Record<string, string>[] = [{ id: "custom:gvim", name: "Vim", command: "gvim" }]) {
  const { OpenInCard } = await import("./GeneralPage");
  const saved: Record<string, unknown>[] = [];
  const Page = () => {
    const [settings, setSettings] = useState<Record<string, unknown>>({ openInApps: apps });
    return createElement(OpenInCard, { settings, onSave: (p: Record<string, unknown>) => (saved.push(p), setSettings((s) => ({ ...s, ...p }))) });
  };
  const m = await mount(createElement(Page), doc);
  unmount = m.unmount;
  await settle();
  return { c: m.container as FakeNode, saved };
}
const field = (c: FakeNode, label: string) => byLabel(c, "input", label)[0];
const add = (c: FakeNode) => byText(c, "button", "Add custom app")[0];
const note = (c: FakeNode) => find(c, (n) => n.attrs.id === "open-in-dup")[0];
const off = (n: FakeNode) => "disabled" in n.attrs;

test("a command already listed turns Add off, names the row and keeps both fields", async () => {
  const { c, saved } = await page();
  expect(note(c).textContent).toBe(""); // the live region is on the page before anything is typed
  await typeInto(c, field(c, "App name"), "My editor");
  await typeInto(c, field(c, "App command"), " GVIM ");
  await settle();
  expect(off(add(c))).toBe(true);
  expect(note(c).textContent).toBe("That command is already listed as Vim.");
  expect(field(c, "App command").attrs["aria-describedby"]).toBe("open-in-dup");
  await click(c, add(c)); // where the fields used to be emptied
  await settle();
  expect(field(c, "App name").value).toBe("My editor");
  expect(field(c, "App command").value).toBe(" GVIM ");
  expect(saved).toEqual([]);
});

test("a new command leaves Add on, with no note, and Add saves it and clears the fields", async () => {
  const { c, saved } = await page();
  await typeInto(c, field(c, "App name"), "Neovim");
  await typeInto(c, field(c, "App command"), "nvim-qt");
  await settle();
  expect(off(add(c))).toBe(false);
  expect(note(c).textContent).toBe("");
  expect(field(c, "App command").attrs["aria-describedby"]).toBeUndefined();
  await click(c, add(c));
  await settle();
  expect(saved).toEqual([{ openInApps: [{ id: "custom:gvim", name: "Vim", command: "gvim" }, { id: "custom:nvim-qt", name: "Neovim", command: "nvim-qt" }] }]);
  expect([field(c, "App name").value, field(c, "App command").value]).toEqual(["", ""]);
});

test("T-759 (DT-C195): removing the row being edited leaves edit mode, so Save cannot clear the fields", async () => {
  const { c, saved } = await page();
  await click(c, byLabel(c, "button", "Edit Vim")[0]);
  await settle();
  expect(byText(c, "button", "Save changes")).toHaveLength(1);
  await click(c, byLabel(c, "button", "Remove Vim")[0]);
  await settle();
  const dialog = find(c, (n) => n.attrs.role === "alertdialog")[0];
  await click(c, byText(dialog, "button", "Remove")[0]);
  await settle();
  expect(saved).toEqual([{ openInApps: [] }]);
  expect(byText(c, "button", "Save changes")).toHaveLength(0); // out of edit mode
  expect(off(add(c))).toBe(true); // nothing to add until a name and command are typed
  expect([field(c, "App name").value, field(c, "App command").value]).toEqual(["", ""]);
});

test("T-759: removing another row while editing keeps the edit", async () => {
  const nvim = { id: "custom:nvim-qt", name: "Neovim", command: "nvim-qt" };
  const { c, saved } = await page([{ id: "custom:gvim", name: "Vim", command: "gvim" }, nvim]);
  await click(c, byLabel(c, "button", "Edit Vim")[0]);
  await settle();
  await typeInto(c, field(c, "App name"), "Vim 9");
  await click(c, byLabel(c, "button", "Remove Neovim")[0]);
  await settle();
  await click(c, byText(find(c, (n) => n.attrs.role === "alertdialog")[0], "button", "Remove")[0]);
  await settle();
  expect(byText(c, "button", "Save changes")).toHaveLength(1);
  expect(field(c, "App name").value).toBe("Vim 9");
  await click(c, byText(c, "button", "Save changes")[0]);
  await settle();
  expect(saved[saved.length - 1]).toEqual({ openInApps: [{ id: "custom:gvim", name: "Vim 9", command: "gvim" }] });
});
