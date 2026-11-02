import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { accountKey, capOn, claudeOf, codexOf, contextFill, meterOf, meterText, percentMode, planOf, readsLeft, shortTokens, shownPercent, tone, usageLine } from "./meter";
import Ring from "./Ring";
import type { ClaudeLimit } from "./claude";
import type { CodexUsage } from "./codex";

const claude: ClaudeLimit[] = [
  { kind: "five_hour", usedPercent: 37.6, resetsAt: null },
  { kind: "seven_day", usedPercent: 63.4, resetsAt: null },
];
const codex: CodexUsage = { state: "ok", fiveHour: { usedPercent: 12, resetsAt: null, windowMins: 300 }, weekly: null, resetCredits: null, plan: "plus", message: null };

test("context fill is measured against the 200k cap, else the model's own window (USAGE-005)", () => {
  expect(contextFill({ tokens: 100_000, window: 1_000_000 })).toBe(50);
  expect(contextFill({ tokens: 100_000, window: 1_000_000 }, false)).toBe(10);
  expect(contextFill({ tokens: 250_000, window: 200_000 })).toBe(100);
  expect(contextFill({ tokens: 5, window: 0 }, false)).toBe(0);
  // USAGE-006: the cap is on until the setting says off; a setting never saved counts as on.
  expect([capOn({}), capOn({ contextCap200k: true }), capOn({ contextCap200k: false })]).toEqual([true, true, false]);
  expect(shortTokens(84_000)).toBe("84k");
  expect(shortTokens(1_250_000)).toBe("1.3M");
  expect(shortTokens(950)).toBe("950");
  expect([tone(69), tone(70), tone(90), tone(91)]).toEqual(["", "warn", "warn", "danger"]);
});

test("plan figures follow the session's agent and vanish when the read failed (USAGE-005)", () => {
  expect(planOf("claude", claude, codex)).toEqual({ fiveHour: 38, weekly: 63 });
  expect(planOf("codex", claude, codex)).toEqual({ fiveHour: 12, weekly: null });
  expect(planOf("codex", claude, { ...codex, state: "error", fiveHour: null })).toBeNull();
  expect(planOf("claude", [], codex)).toBeNull();
  expect(planOf("shell", claude, codex)).toBeNull();
  expect(planOf("claude", [{ kind: "seven_day", usedPercent: 20, resetsAt: null }], null)).toEqual({ fiveHour: null, weekly: 20 });
});

test("the Board meter shows the context bar only after a reading, plan figures without it, and nothing with neither (USAGE-002)", () => {
  const full = meterOf({ tokens: 84_000, window: 200_000 }, "claude", claude, codex)!;
  expect(full).toEqual({ context: { tokens: 84_000, window: 200_000, percent: 42 }, plan: { fiveHour: 38, weekly: 63 } });
  expect(meterText(full)).toBe("Context 84k / 200k (42%)\n5-hour 38% · Weekly 63%");
  const fresh = meterOf(undefined, "claude", claude, codex)!;
  expect(fresh.context).toBeUndefined();
  expect(meterText(fresh)).toBe("5-hour 38% · Weekly 63%");
  expect(meterText(meterOf(undefined, "claude", [{ kind: "seven_day", usedPercent: 20, resetsAt: null }], null)!)).toBe("Weekly 20%");
  expect(meterOf(undefined, "shell", claude, codex)).toBeNull();
  expect(meterOf({ tokens: 10, window: 200_000 }, "kimi", [], null)?.plan).toBeUndefined();
});

test("the ring fills with the percentage and turns with it (USAGE-003)", () => {
  const html = renderToString(createElement(Ring, { percent: 42, size: 10, title: "Context 84k / 200k (42%)" }));
  expect(html).toContain('class="ring"');
  expect(html).toContain("<title>Context 84k / 200k (42%)</title>");
  expect(html).not.toContain("42%<");
  expect(renderToString(createElement(Ring, { percent: 95 }))).toContain('class="ring danger"');
});

test("USAGE-004 / VIEW-018: the Agents footer gives the provider's 5-hour figure and reset time, used or left, never NaN, blank without a window", () => {
  const now = new Date(2026, 9, 12, 12, 0, 0);
  const at = new Date(2026, 9, 12, 15, 0, 0).getTime();
  const claude: ClaudeLimit[] = [
    { kind: "five_hour", usedPercent: 37.6, resetsAt: at },
    { kind: "seven_day", usedPercent: 80, resetsAt: null },
  ];
  const line = usageLine("claude", claude, null, false, now);
  expect(line.startsWith("Claude 38% used · resets today ")).toBe(true);
  expect(usageLine("claude", claude, null, true, now).startsWith("Claude 62% left · resets today ")).toBe(true);
  // A broken provider value reads 0, never NaN; a reset time nobody knows says so.
  expect(usageLine("claude", [{ kind: "five_hour", usedPercent: NaN, resetsAt: null }], null, false, now)).toBe("Claude 0% used · reset time unknown");
  // A provider with no 5-hour window keeps the line empty; so does a plain shell.
  expect(usageLine("claude", [{ kind: "seven_day", usedPercent: 80, resetsAt: null }], null, false, now)).toBe("");
  expect(usageLine("shell", claude, null, false, now)).toBe("");
  const codex: CodexUsage = { state: "ok", fiveHour: { usedPercent: 40, resetsAt: Math.round(at / 1000), windowMins: 300 }, weekly: null, resetCredits: null, plan: null, message: null };
  expect(usageLine("codex", [], codex, false, now).startsWith("Codex 40% used · resets today ")).toBe(true);
  expect(usageLine("codex", [], codex, true, now).startsWith("Codex 60% left · ")).toBe(true);
  expect(usageLine("codex", [], { ...codex, state: "signed-out", fiveHour: null }, false, now)).toBe("");
  // USAGE-025: the display choice is a settings key; missing or unrecognised means used.
  expect(readsLeft({})).toBe(false);
  expect(readsLeft({ usageReads: "remaining" })).toBe(false);
  expect(readsLeft({ usageReads: "left" })).toBe(true);
  // MERGE 13: the T-263 Appearance pick reads left too.
  expect(readsLeft({ usagePercentages: "remaining" })).toBe(true);
  expect(readsLeft({ usagePercentages: "used" })).toBe(false);
});

test("T-263 USAGE-025: usage percentages read as used or left; missing or unknown means used, a broken value reads 0", () => {
  expect(percentMode(undefined)).toBe("used");
  expect(percentMode("left-ish")).toBe("used");
  expect(percentMode("remaining")).toBe("remaining");
  expect(shownPercent(30, "remaining")).toBe(70);
  expect(shownPercent(30, "used")).toBe(30);
  expect(shownPercent(29.6, "used")).toBe(30);
  expect(shownPercent(140, "remaining")).toBe(0);
  expect(shownPercent(-5, "used")).toBe(0);
  expect(shownPercent(Number.NaN, "remaining")).toBe(0);
});

// T-548 (council AFTER, MERGE 42): src/usage holds the figures of the ACTIVE Codex account only, so a pane
// begun on another account must not carry them into its Board card or its Tower row.
test("T-548: a Codex pane on another account than the active one gets no plan figures; a pane on the active one, or not yet started, keeps them", () => {
  expect(codexOf("codex", "b", "a", codex)).toBeNull();
  expect(codexOf("codex", null, "a", codex)).toBeNull(); // began on Codex's own sign-in, which is not the active account
  expect(codexOf("codex", "a", "a", codex)).toBe(codex);
  expect(codexOf("codex", null, null, codex)).toBe(codex);
  expect(codexOf("codex", undefined, "a", codex)).toBe(codex); // no account recorded yet: unknown, so nothing is hidden
  expect(codexOf("claude", "b", "a", codex)).toBe(codex); // only Codex panes are held back
  expect(meterOf(undefined, "codex", claude, codexOf("codex", "b", "a", codex))).toBeNull();
  expect(meterOf(undefined, "codex", claude, codexOf("codex", "a", "a", codex))?.plan).toEqual({ fiveHour: 12, weekly: null });
});

// T-548-b: the figures read for another account reach the pane that runs on it.
test("T-548-b: a Codex pane on another account gets that account's own figures when they were read; the key of the system default is empty", () => {
  const other: CodexUsage = { ...codex, fiveHour: { usedPercent: 80, resetsAt: null, windowMins: 300 } };
  const by = { b: other, "": { ...codex, weekly: { usedPercent: 9, resetsAt: null, windowMins: null } } };
  expect(codexOf("codex", "b", "a", codex, by)).toBe(other);
  expect(codexOf("codex", null, "a", codex, by)).toBe(by[""]); // Codex's own sign-in while a managed account is active
  expect(codexOf("codex", "c", "a", codex, by)).toBeNull(); // not read yet: no figures rather than another account's
  expect(codexOf("codex", "a", "a", codex, by)).toBe(codex); // the active account keeps the pill's figures
  expect(codexOf("claude", "b", "a", codex, by)).toBe(codex);
  expect(accountKey(null)).toBe("");
  expect(accountKey("b")).toBe("b");
  expect(meterOf(undefined, "codex", claude, codexOf("codex", "b", "a", codex, by))?.plan).toEqual({ fiveHour: 80, weekly: null });
});

// T-548-b: the Claude half of the same rule. src/usage holds the active Claude account's windows (the pill);
// a pane on another managed account gets the windows read for its own folder, never the active account's.
test("T-548-b: claudeOf gives a Claude pane its own account's windows; the active account keeps the pill's", () => {
  const own: ClaudeLimit[] = [{ kind: "five_hour", usedPercent: 80, resetsAt: null }, { kind: "seven_day", usedPercent: 9, resetsAt: null }];
  const by = { b: own, "": [{ kind: "five_hour", usedPercent: 3, resetsAt: null }] };
  expect(claudeOf("claude", "b", "a", claude, by)).toBe(own);
  expect(claudeOf("claude", null, "a", claude, by)).toBe(by[""]); // Claude's own sign-in while a managed account is active
  expect(claudeOf("claude", "c", "a", claude, by)).toEqual([]); // not read yet: no figures rather than another account's
  expect(claudeOf("claude", "a", "a", claude, by)).toBe(claude);
  expect(claudeOf("claude", null, null, claude, by)).toBe(claude);
  expect(claudeOf("claude", undefined, "a", claude, by)).toBe(claude); // no account recorded yet: unknown, so nothing is hidden
  expect(claudeOf("codex", "b", "a", claude, by)).toBe(claude); // only Claude panes are held back
  expect(planOf("claude", claudeOf("claude", "b", "a", claude, by), null)).toEqual({ fiveHour: 80, weekly: 9 });
  expect(planOf("claude", claudeOf("claude", "c", "a", claude, by), null)).toBeNull();
  expect(usageLine("claude", claudeOf("claude", "b", "a", claude, by), null, false, new Date(0))).toContain("Claude 80% used");
});
