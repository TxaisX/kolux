import { expect, test } from "vitest";
import { headerLabels, HINT_MAX, overflows } from "./headers";

test("a name no other project has shows the folder name alone", () => {
  const l = headerLabels([
    { id: "a", name: "app", path: "C:/work/app" },
    { id: "b", name: "site", path: "C:/work/site" },
  ]);
  expect(l.a).toEqual({ name: "app", hint: null, hintCut: null });
  expect(l.b.hint).toBeNull();
});

test("two projects both called app show a path fragment that separates them, and only they do", () => {
  const l = headerLabels([
    { id: "a", name: "app", path: "C:/work/client/app" },
    { id: "b", name: "app", path: "D:/home/client/app" },
    { id: "c", name: "site", path: "C:/work/site" },
  ]);
  expect(l.a.hint).toBe("work/client");
  expect(l.b.hint).toBe("home/client");
  expect(l.a.hint).not.toBe(l.b.hint);
  expect(l.c.hint).toBeNull();
});

test("the same name in different letter case still clashes", () => {
  const l = headerLabels([
    { id: "a", name: "App", path: "C:/one/App" },
    { id: "b", name: "app", path: "C:/two/app" },
  ]);
  expect(l.a.hint).toBe("one");
  expect(l.b.hint).toBe("two");
});

test("a long path fragment is shortened in the middle and keeps the full text", () => {
  const l = headerLabels([
    { id: "a", name: "app", path: "C:/alpha-long-folder-name/client/app" },
    { id: "b", name: "app", path: "C:/bravo-long-folder-name/client/app" },
  ]);
  expect(l.a.hint!.length).toBeGreaterThan(HINT_MAX);
  expect(l.a.hintCut!.length).toBe(HINT_MAX);
  expect(l.a.hintCut).toContain("…");
  expect(l.b.hintCut).toContain("…");
  expect(l.a.hintCut).not.toBe(l.b.hintCut);
});

test("a label counts as shortened only when its text really overflows", () => {
  expect(overflows(120, 100)).toBe(true);
  expect(overflows(100, 100)).toBe(false);
});
