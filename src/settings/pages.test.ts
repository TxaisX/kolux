import { expect, test } from "vitest";
import { PAGE_GROUPS, PAGES, pageOf } from "./pages";

test("exactly the eleven pages, in order", () => {
  expect(Object.values(PAGES)).toEqual(["General", "Appearance", "Accounts & keys", "Agents", "Terminal & sessions", "Git & worktrees", "Safety", "Notifications", "Shortcuts", "Usage", "Claude"]);
});

test("the rail groups every page once, in Claude's order", () => {
  const ids = PAGE_GROUPS.flatMap((g) => g.pages);
  expect(ids).toHaveLength(Object.keys(PAGES).length);
  expect([...ids].sort()).toEqual(Object.keys(PAGES).sort());
  expect(PAGE_GROUPS.map((g) => g.title)).toEqual(["Personal", "AI", "Workspace", "Usage"]);
});

test("a remembered page opens only while it still exists", () => {
  expect(pageOf("shortcuts", [])).toBe("shortcuts");
  expect(pageOf("repo:p1", ["p1"])).toBe("repo:p1");
  expect(pageOf("repo:gone", ["p1"])).toBe("general");
  expect(pageOf("connections", [])).toBe("general");
  expect(pageOf(null, [])).toBe("general");
});
