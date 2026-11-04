// SET-043: skipped confirmations come back one by one or all together.
import { expect, test } from "vitest";
import { asksBeforeDelete } from "../projects/deleting";
import { asksBeforeClose } from "../terminal/closing";
import { pinAsks } from "../terminal/pin";
import { askAgainPatch, SKIPPABLE, skippedOf, skippedSentence } from "./confirmations";

test("SET-043: nothing is skipped on a fresh install, and every confirmation is asked", () => {
  expect(skippedOf({})).toEqual([]);
  expect(skippedSentence({})).toBe("Every confirmation is asked.");
  expect(askAgainPatch({})).toEqual({});
  expect(SKIPPABLE).toHaveLength(4);
  expect(new Set(SKIPPABLE.map((c) => c.field)).size).toBe(4);
});

test("SET-043: each skipped confirmation is remembered on its own", () => {
  const s = { confirmWorkspaceDelete: false };
  expect(asksBeforeDelete(s)).toBe(false);
  expect(asksBeforeClose(s)).toBe(true);
  expect(skippedOf(s).map((c) => c.label)).toEqual(["deleting a workspace"]);
});

test("SET-043: closing a pinned tab asks by default, and turning it back on makes the next close ask", () => {
  expect(pinAsks({})).toBe(true);
  const s = { pinnedTabsAsk: false, confirmWorkspaceDelete: false, other: 1 };
  expect(pinAsks(s)).toBe(false);
  const patch = askAgainPatch(s);
  expect(patch).toEqual({ pinnedTabsAsk: true, confirmWorkspaceDelete: true });
  const after = { ...s, ...patch };
  expect(pinAsks(after)).toBe(true);
  expect(asksBeforeDelete(after)).toBe(true);
  expect(skippedOf(after)).toEqual([]);
});

test("SET-043: the sentence names every skipped question", () => {
  expect(skippedSentence({ pinnedTabsAsk: false, confirmCloseRunning: false })).toBe("Not asking before closing a pinned tab or closing a terminal that is running a program.");
  expect(skippedSentence({ pinnedTabsAsk: false, confirmCloseRunning: false, confirmAutomationDelete: false })).toBe(
    "Not asking before closing a pinned tab, deleting an automation or closing a terminal that is running a program.",
  );
});
