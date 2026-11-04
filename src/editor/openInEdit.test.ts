import { expect, test } from "vitest";
import { addCustom, DEFAULT_APPS, OPEN_IN_FIELD, openInItems, readOpenIn } from "../settings/openIn";
import { alreadyListed, editApp } from "./openInEdit";

test("SET-039 (T-237-b): editing a custom app changes its name and command and keeps its place", () => {
  const list = addCustom(DEFAULT_APPS, { name: "Vim", command: "gvim" });
  const out = editApp(list, "custom:gvim", { name: "GVim", command: "gvim --remote" });
  expect(out.map((a) => a.name)).toEqual(["File Explorer", "Visual Studio Code", "GVim"]);
  expect(openInItems({ [OPEN_IN_FIELD]: out })[2]).toEqual({ id: "custom:gvim --remote", label: "Open in GVim", command: "gvim --remote" });
  expect(readOpenIn({ [OPEN_IN_FIELD]: out })).toEqual(out); // it survives a save and read
});

test("SET-039 (T-237-b): editing a preset turns it into a custom row in the same place, so the edit is not lost on read", () => {
  const out = editApp(DEFAULT_APPS, "vscode", { name: "Code Insiders", command: "code-insiders" });
  expect(out.map((a) => a.id)).toEqual(["explorer", "custom:code-insiders"]);
  expect(readOpenIn({ [OPEN_IN_FIELD]: out }).map((a) => a.name)).toEqual(["File Explorer", "Code Insiders"]);
});

test("SET-039 (T-237-b): an empty field, an unchanged row, an unknown id or a duplicate command changes nothing", () => {
  const list = addCustom(DEFAULT_APPS, { name: "Vim", command: "gvim" });
  expect(editApp(list, "custom:gvim", { name: " ", command: "gvim" })).toBe(list);
  expect(editApp(list, "custom:gvim", { name: "Vim", command: "  GVIM " })).toBe(list);
  expect(editApp(list, "nope", { name: "x", command: "y" })).toBe(list);
  const two = addCustom(list, { name: "Emacs", command: "emacs" });
  expect(editApp(two, "custom:emacs", { name: "Dup", command: "GVIM" })).toBe(two);
});

test("T-753 (DT-C189): a command already listed is found, so the card says so instead of clearing the fields", () => {
  const list = addCustom(DEFAULT_APPS, { name: "Vim", command: "gvim" });
  expect(addCustom(list, { name: "Again", command: " GVIM " }), "Add alone drops it").toBe(list);
  expect(alreadyListed(list, { name: "Again", command: " GVIM " }, null)?.name).toBe("Vim");
  expect(alreadyListed(list, { name: "Emacs", command: "emacs" }, null), "a new command").toBeUndefined();
  expect(alreadyListed(list, { name: "", command: "gvim" }, null), "not ready yet: no note").toBeUndefined();
  expect(alreadyListed(list, { name: "Vim 2", command: "gvim" }, "custom:gvim"), "renaming the row itself").toBeUndefined();
  expect(alreadyListed(list, { name: "Code", command: "gvim" }, "vscode")?.name, "editing another row into it").toBe("Vim");
  const code = addCustom(DEFAULT_APPS, { name: "My Code", command: "code" });
  expect(alreadyListed(code, { name: "Code 2", command: "code" }, "vscode")?.name, "a preset edited into a custom row").toBe("My Code");
  expect(editApp(code, "vscode", { name: "Code 2", command: "code" }), "which Save would refuse").toBe(code);
});
