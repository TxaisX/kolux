import { expect, test } from "vitest";
import { fontStack, rankFonts } from "./fonts";
import { appearanceVars, readAppearance, writeAppearance, uiFont } from "../theme";

const LIST = ["Arial", "Cascadia Code", "Cascadia Mono", "Consolas", "Lucida Console", "Segoe UI"];

test("SET-018: names that begin with the text rank above names that only contain it", () => {
  expect(rankFonts(LIST, "co")).toEqual(["Consolas", "Cascadia Code", "Lucida Console"]);
  expect(rankFonts(LIST, "CAS")).toEqual(["Cascadia Code", "Cascadia Mono"]);
  expect(rankFonts(LIST, "")).toEqual(LIST);
});

test("SET-018: a safe fallback always follows the chosen family; empty means the default", () => {
  expect(fontStack("Comic Sans MS", uiFont)).toBe(`"Comic Sans MS", ${uiFont}`);
  expect(fontStack('  Evil"; } body { x', uiFont)).toBe(`"Evil  body  x", ${uiFont}`);
  expect(fontStack("  ", uiFont)).toBe(uiFont);
});

test("SET-018: the app font is kept; the editor font went with the editor and a saved one is not written back", () => {
  const a = readAppearance({ appFont: "Segoe UI", editorFont: "Consolas" });
  expect(a.appFont).toBe("Segoe UI");
  expect(writeAppearance({}, a)).toMatchObject({ appFont: "Segoe UI" });
  expect(writeAppearance({}, a)).not.toHaveProperty("editorFont");
  expect(appearanceVars(a)["--ui-font"]).toBe(`"Segoe UI", ${uiFont}`);
  expect(appearanceVars(a)).not.toHaveProperty("--editor-font");
  expect(readAppearance({ appFont: 42 }).appFont).toBe("");
});
