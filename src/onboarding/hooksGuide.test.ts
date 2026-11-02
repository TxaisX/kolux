// T-608, DT-C52: the user guide is the app's own description of the status hooks, so it has to carry the one
// line of consent word for word and say that the switch starts on. This check failed while the guide still
// described the pre-DT-C52 default ("Off until you turn it on", "Until the switch is on", "off until you turn
// it on") and never mentioned the line (STATE.md follow-up of 2026-10-30).
import { expect, test } from "vitest";
import started from "../../docs/guide/getting-started.md?raw";
import settings from "../../docs/guide/settings.md?raw";
import { HOOKS_FIELD, HOOKS_LINE } from "./hooksOn";

const hooksRow = () => settings.split("\n").find((l) => l.startsWith("|") && l.includes(`\`${HOOKS_FIELD}\``)) ?? "";

test("both guide pages carry the consent line exactly as the app shows it", () => {
  expect(settings).toContain(HOOKS_LINE);
  expect(started).toContain(HOOKS_LINE);
});

test("the Agents table says the switch starts on, not off until turned on", () => {
  expect(hooksRow()).toMatch(/on by default|starts on/i);
  expect(hooksRow()).not.toMatch(/Off until you turn it on/);
  expect(settings).not.toMatch(/is off until you turn it on/i);
  expect(settings).not.toMatch(/Until the switch is on/);
});

test("the first-run page says the Connect step shows the line and that its card takes the launch's one tip", () => {
  const connect = started.split("\n").find((l) => l.startsWith("| 2. Connect an AI")) ?? "";
  expect(connect).toContain(HOOKS_LINE);
  expect(connect).toMatch(/Back does not/);
  const tips = started.slice(started.indexOf("### Tips"), started.indexOf("### Tours"));
  expect(tips).toMatch(/status-hooks card[^\n]*no tip/i);
});
