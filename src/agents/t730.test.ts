// T-730 / DT-C166: the right-sidebar tab that lists past sessions is "History", not "Agents" (the Agents screen's name).
import { expect, test } from "vitest";
import { RIGHT_TABS, splitTabs } from "../chrome/RightSidebar";

test("the right-sidebar tab for past sessions is called History and fits the strip at the default width", () => {
  const tab = RIGHT_TABS.find((t) => t.id === "agents");
  expect(tab?.label).toBe("History");
  expect(RIGHT_TABS.some((t) => t.label === "Agents")).toBe(false);
  // a plain workspace offers Explorer, Insights, Checks and this tab; at 300 px none goes into More
  const plain = RIGHT_TABS.filter((t) => ["explorer", "insights", "checks", "agents"].includes(t.id));
  expect(splitTabs(plain, "explorer", 300).more).toEqual([]);
});
