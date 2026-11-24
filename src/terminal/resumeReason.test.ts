// START-02 review (P2): ending a resumed agent pane early (Resource Manager's End, the backend close) must
// not wipe its saved conversation id. On Windows Kolux's own kill reports exit 1, so the exit code alone
// cannot tell a failed resume from a pane the user ended: START-04's reason decides, as the exit banner
// already does, and a terminal taken back after a reload is never judged on a clock that restarted at its bind.
import { describe, expect, test } from "vitest";
import { isFailedResume, type ResumeExit } from "./layout";
import paneRaw from "./TerminalPane.tsx?raw";

const base: ResumeExit = { resumed: true, reason: "exited", code: 1, aliveMs: 2_000, hookSeen: false };

describe("START-02: a pane Kolux ended is not a failed resume", () => {
  test("the same quick exit 1 is a failed resume only when the program ended by itself", () => {
    expect(isFailedResume(base)).toBe(true);
    expect(isFailedResume({ ...base, reason: "closed" })).toBe(false);
  });

  test("a close is never a failed resume, whatever the code or the clock says", () => {
    expect(isFailedResume({ ...base, reason: "closed", aliveMs: 0 })).toBe(false);
    expect(isFailedResume({ ...base, reason: "closed", code: -1 })).toBe(false);
    expect(isFailedResume({ ...base, reason: "closed", code: 1, aliveMs: 14_999 })).toBe(false);
  });
});

const code = (raw: string) =>
  raw
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");

describe("START-02 wiring: the pane hands the exit's own reason in", () => {
  test("the exit listener passes reason, from the same START-04 guard the banner uses", () => {
    const pane = code(paneRaw);
    const at = pane.indexOf("isFailedResume(");
    expect(at).toBeGreaterThan(-1);
    const call = pane.slice(at, at + 400);
    expect(call).toMatch(/reason:\s*e\.payload\.reason === "exited" \?\s*"exited"\s*:\s*"closed"/);
  });

  test("a terminal taken back after a reload is not judged: runBegan restarts at its bind", () => {
    const pane = code(paneRaw);
    expect(pane).toMatch(/attachedRun\.current = back\?\.kind === "attached"/);
    const at = pane.indexOf("isFailedResume(");
    expect(pane.slice(Math.max(0, at - 200), at)).toMatch(/!attachedRun\.current/);
  });
});
