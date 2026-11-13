import { expect, test } from "vitest";
import { behindHint, hintDismissed, HINT_DISMISSED_SETTING, isBehindHint, REFRESH_SETTING, refreshesOnCreate } from "./baseHint";

// the sentence refresh_base makes in projects.rs
const hint = "main is 3 commits behind origin/main; update it, or turn on Refresh the base first in Settings > Git & worktrees";
const other = "main was not refreshed: its worktree has uncommitted changes, so this workspace starts from the local main";

test("the behind suggestion is told apart from the other notes", () => {
  expect(isBehindHint(hint)).toBe(true);
  expect(isBehindHint(hint.replace("3 commits", "1 commit"))).toBe(true);
  expect(isBehindHint(other)).toBe(false);
  expect(isBehindHint("the saved base x no longer exists in api; this workspace started from main instead")).toBe(false);
});

test("create again after dismissing the hint: no hint, the other notes stay", () => {
  expect(behindHint([hint, other], {})).toBe(hint);
  const dismissed = { [HINT_DISMISSED_SETTING]: true };
  expect(hintDismissed(dismissed)).toBe(true);
  expect(behindHint([hint, other], dismissed)).toBeNull();
});

test("automatic updating is off unless the setting is exactly true", () => {
  expect(refreshesOnCreate({})).toBe(false);
  expect(refreshesOnCreate({ [REFRESH_SETTING]: "true" })).toBe(false);
  expect(refreshesOnCreate({ [REFRESH_SETTING]: 1 })).toBe(false);
  expect(refreshesOnCreate({ [REFRESH_SETTING]: false })).toBe(false);
  expect(refreshesOnCreate({ [REFRESH_SETTING]: true })).toBe(true);
});

test("a setting that is not exactly true does not count as dismissed", () => {
  expect(hintDismissed({ [HINT_DISMISSED_SETTING]: "yes" })).toBe(false);
});
