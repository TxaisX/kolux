import { expect, test } from "vitest";
import { everydaySessions, isEveryday, samePlace } from "./everyday";
import type { FolderSession } from "./folderSessions";

test("the same place ignores case, separators and a trailing slash", () => {
  expect(samePlace("C:\\Users\\X\\Kolux\\Everyday", "c:/users/x/kolux/everyday/")).toBe(true);
  expect(samePlace("C:\\Users\\X\\Kolux\\Everyday", "C:\\Users\\X\\Kolux\\Elsewhere")).toBe(false);
  expect(samePlace(null, "C:\\x")).toBe(false);
  expect(samePlace("C:\\x", undefined)).toBe(false);
});

test("only the Everyday path is the Everyday folder", () => {
  expect(isEveryday("C:\\Users\\X\\Kolux\\Everyday\\", "c:\\users\\x\\kolux\\everyday")).toBe(true);
  expect(isEveryday("C:\\Users\\X\\Kolux\\repo", "C:\\Users\\X\\Kolux\\Everyday")).toBe(false);
});

const session = (key: number, over: Partial<FolderSession> = {}): FolderSession => ({ key, agent: "claude", title: `chat ${key}`, cwd: null, running: false, ...over });

test("the everyday list is the panes opened there, in the window's own order", () => {
  const list = [
    session(1, { cwd: "C:\\Users\\X\\Kolux\\Everyday" }),
    session(2, { cwd: "C:\\Users\\X\\Kolux\\repo", view: "C:\\Users\\X\\Kolux\\Everyday" }),
    session(3, { cwd: "C:\\Users\\X\\Kolux\\repo" }),
    session(4, { cwd: "C:\\Users\\X\\Kolux\\Everyday", running: true }),
  ];
  expect(everydaySessions(list, "c:/users/x/kolux/everyday/").map((s) => s.key)).toEqual([1, 2, 4]);
  expect(everydaySessions(list, null)).toEqual([]);
});
