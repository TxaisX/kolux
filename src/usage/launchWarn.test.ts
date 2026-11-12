import { expect, test } from "vitest";
import { claudeFigures, launchWarnings, type ProviderUsage } from "./launchWarn";

const now = new Date(2026, 9, 11, 12, 0);
const at = (h: number) => new Date(2026, 9, 11, h, 30).getTime() / 1000;
const claude = (used: number, weekly?: number): ProviderUsage => ({ name: "Claude", fiveHour: { usedPercent: used, resetsAt: at(14), windowMins: 300 }, weekly: weekly == null ? null : { usedPercent: weekly, resetsAt: null, windowMins: 10080 } });
const codex = (used: number): ProviderUsage => ({ name: "Codex", fiveHour: null, weekly: { usedPercent: used, resetsAt: null, windowMins: 10080 } });

test("three Claude seats at 85% give one line that counts them and says when it resets", () => {
  const lines = launchWarnings(["claude", "claude", "claude"], { claude: claude(85) }, now);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("85% of its 5-hour window");
  expect(lines[0]).toContain("These 3 Claude sessions");
  expect(lines[0]).toMatch(/resets today/);
});

test("one seat is named, a second provider over the mark adds its own line, 80% exactly counts", () => {
  const lines = launchWarnings(["claude", "codex", "shell-terminal"], { claude: claude(80), codex: codex(90) }, now);
  expect(lines).toEqual([expect.stringContaining("This Claude session"), expect.stringContaining("Codex has used 90% of its weekly window. This Codex session")]);
});

test("under 80%, no figures, or an agent with no usage source: no line", () => {
  expect(launchWarnings(["claude"], { claude: claude(40) }, now)).toEqual([]);
  expect(launchWarnings(["claude"], { claude: claude(79.4) }, now)).toEqual([]);
  expect(launchWarnings(["claude", "codex"], {}, now)).toEqual([]);
  expect(launchWarnings(["gemini", null], { claude: claude(99) }, now)).toEqual([]);
});

test("the shortest window with a figure is the one checked: a busy week behind a quiet 5 hours does not warn", () => {
  expect(launchWarnings(["claude"], { claude: claude(10, 95) }, now)).toEqual([]);
  expect(launchWarnings(["codex"], { codex: codex(95) }, now)).toHaveLength(1);
});

test("Claude's read limits feed the warning as its 5-hour and weekly windows; no limits give no figures", () => {
  const u = claudeFigures([{ kind: "seven_day", usedPercent: 40, resetsAt: null }, { kind: "five_hour", usedPercent: 91, resetsAt: at(14) * 1000 }]);
  expect(u?.fiveHour?.usedPercent).toBe(91);
  expect(u?.fiveHour?.resetsAt).toBe(at(14));
  expect(u?.weekly?.usedPercent).toBe(40);
  const line = launchWarnings(["claude"], { claude: u }, now)[0];
  expect(line).toContain("Claude has used 91% of its 5-hour window");
  expect(line).toMatch(/resets today/);
  expect(claudeFigures([])).toBeUndefined();
});
