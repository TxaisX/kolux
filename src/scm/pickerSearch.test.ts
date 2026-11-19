import { expect, test } from "vitest";
import { pickList } from "./pickerSearch";

test("EDIT-048: part of a branch name lists the matching branches, prefix matches first", () => {
  const branches = ["main", "feature/login", "fix/login-loop", "release/1.0", "login-page"];
  expect(pickList(branches, "login").shown).toEqual(["login-page", "feature/login", "fix/login-loop"]);
  expect(pickList(branches, "FIX login").shown).toEqual(["fix/login-loop"]);
  expect(pickList(branches, "").shown).toEqual(branches);
  expect(pickList(branches, "zzz")).toEqual({ shown: [], more: 0 });
});

test("EDIT-048: thousands of branches give a short list quickly, with the rest counted", () => {
  const many = Array.from({ length: 20000 }, (_, i) => `feature/branch-${i}`);
  const t = performance.now();
  const r = pickList(many, "branch-1");
  expect(performance.now() - t).toBeLessThan(200);
  expect(r.shown.length).toBe(50);
  expect(pickList(many.slice(0, 120), "feature", 50)).toMatchObject({ shown: expect.any(Array) });
  const small = pickList(many.slice(0, 120), "branch", 50);
  expect(small.shown.length).toBe(50);
  expect(small.more).toBeGreaterThan(0);
});
