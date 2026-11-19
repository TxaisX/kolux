import { expect, test } from "vitest";
import { cleanApps, commandOf, FILE_MANAGER, MAX_APPS, targetsOf } from "./openIn";

test("T-323-b: out of the box the menu offers File Explorer, then VS Code, as General settings lists them", () => {
  expect(targetsOf(null)).toEqual([FILE_MANAGER, { label: "Visual Studio Code", command: "code" }]);
  expect(targetsOf({})).toEqual(targetsOf(null));
});

test("T-323-b: the menu follows the saved list, in the user's order, and rows saved with a label still show", () => {
  const s = { openInApps: [{ id: "zed", name: "Zed", command: "zed" }, { label: "Mine", command: "mine --x" }, { id: "explorer", name: "File Explorer", command: "explorer" }] };
  expect(targetsOf(s)).toEqual([{ label: "Zed", command: "zed" }, { label: "Mine", command: "mine --x" }, FILE_MANAGER]);
});

test("EDIT-043: a row with a label but no command, or a command but no label, is discarded; the list is capped", () => {
  const apps = cleanApps([{ label: "Mine", command: "" }, { label: "", command: "zed" }, { label: " Zed ", command: " zed " }, { label: "Bad", command: 7 }, null]);
  expect(apps).toEqual([{ label: "Zed", command: "zed" }]);
  const many = Array.from({ length: MAX_APPS + 3 }, (_, i) => ({ label: `App ${i}`, command: `app${i}` }));
  expect(cleanApps(many).length).toBe(MAX_APPS);
  expect(cleanApps([])).toEqual([]);
  expect(targetsOf({ openInApps: [] })).toEqual([]); // the user removed every app
});

test("EDIT-043: an app with an empty command launches VS Code; the file manager has no command", () => {
  expect(commandOf({ label: "Mine", command: "  " })).toBe("code");
  expect(commandOf({ label: "Zed", command: "zed --new" })).toBe("zed --new");
  expect(commandOf(FILE_MANAGER)).toBe(null);
});

import { fileTargetsOf, relInside } from "./openIn";

test("T-323-b: a single file's Open in lists the saved apps in order, without the file manager", () => {
  expect(fileTargetsOf(null)).toEqual([{ label: "Visual Studio Code", command: "code" }]);
  const s = { openInApps: [{ id: "explorer", name: "File Explorer", command: "explorer" }, { id: "zed", name: "Zed", command: "zed" }, { id: "vscode", name: "Visual Studio Code", command: "code" }] };
  expect(fileTargetsOf(s).map((a) => a.label)).toEqual(["Zed", "Visual Studio Code"]);
});

test("T-323-b: a file is opened by its path inside the worktree, and nothing outside it", () => {
  expect(relInside("C:\\dev\\app", "C:\\dev\\app\\src\\a.ts")).toBe("src/a.ts");
  expect(relInside("C:/Dev/app/", "c:/dev/app/x.md")).toBe("x.md");
  expect(relInside("/home/u/app", "/home/u/app/a/b.rs")).toBe("a/b.rs");
  expect(relInside("/home/u/app", "/home/u/App/a.rs")).toBe(null);
  expect(relInside("/home/u/app", "/home/u/app2/a.rs")).toBe(null);
  expect(relInside("/home/u/app", "/home/u/app")).toBe(null);
  expect(relInside("/home/u/app", "/home/u/app/../x")).toBe(null);
});
