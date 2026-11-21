// SESS-025 box 2: a Solo launch's opening prompt carries no rules block.
import { expect, test } from "vitest";
import { openingPrompt, pickShape, ROLE_BRIEFS, rulesBlock, withoutRules } from "../seats";

test("SESS-025 box 2: Solo with a task -> the opening prompt is the role brief and the task, with no rules block", () => {
  const solo = pickShape("solo", [{ agent: "claude", model: "opus" }]);
  expect(solo).toHaveLength(1);
  // No note was asked (a launch with no project folder), so no rules block is handed over.
  const prompt = openingPrompt(solo[0], "Fix the login page", null);
  expect(prompt).toBe(`${ROLE_BRIEFS.builder}\n\nFix the login page`);
  const rules = rulesBlock("C:/proj/.kolux/handoffs/x.md");
  for (const words of ["alongside", "handoff note", "documentation"]) {
    expect(rules).toContain(words);
    expect(prompt).not.toContain(words);
  }
  expect(withoutRules(prompt)).toBe(prompt);
  // Contrast: two seats side by side do get the block behind the task.
  expect(openingPrompt(solo[0], "Fix the login page", rules)).toContain(rules);
});
