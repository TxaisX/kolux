// SKILL-024 / SKILL-026: when the update notice appears and what the dialog says about a run.
import { expect, test } from "vitest";
import { chipTone, claimNotice, freshKeys, noticeShown, resetNoticeClaim, noticeText, sumUpRun, updatable, type Checked, type Report, type UpdateStatus } from "./updateNotice";

const report = (over: Partial<Report> = {}): Report => ({
  rows: [
    { name: "orchestration", state: "available", reason: null, reinstall: null, copies: [] },
    { name: "koluxward", state: "skipped", reason: "changed", reinstall: "npx --yes skills add TxaisX/kolux-skills --skill koluxward -g", copies: [] },
  ],
  available: 1,
  revisions: [],
  notice: ["C:\\h\\orchestration\\SKILL.md|abc"],
  ...over,
});
const checked = (over: Partial<Checked> = {}): Checked => ({ report: report(), dismissed: [], ...over });

test("SKILL-024: the notice shows when something qualifies and settings have loaded", () => {
  expect(noticeShown(checked(), true, false)).toBe(true);
  expect(noticeShown(checked(), false, false)).toBe(false);
  expect(noticeShown(null, true, false)).toBe(false);
  expect(noticeShown(checked({ report: report({ available: 0, notice: [] }) }), true, false)).toBe(false);
});

test("SKILL-024: a dismissed copy at the same revision stays quiet, a new revision speaks again, and a session shows it once", () => {
  const key = "C:\\h\\orchestration\\SKILL.md|abc";
  expect(noticeShown(checked({ dismissed: [key] }), true, false)).toBe(false);
  expect(noticeShown(checked({ dismissed: [key], report: report({ notice: [key, "C:\\h\\orchestration\\SKILL.md|def"] }) }), true, false)).toBe(true);
  expect(freshKeys(checked({ dismissed: [key], report: report({ notice: [key, "x|1"] }) }))).toEqual(["x|1"]);
  expect(noticeShown(checked(), true, true)).toBe(false);
});

test("SKILL-024: project copies never reach the notice (the keys come from the app, none for a skipped skill)", () => {
  expect(noticeShown(checked({ report: report({ notice: [], available: 1 }) }), true, false)).toBe(false);
  expect(updatable(report())).toEqual(["orchestration"]);
});

test("SKILL-024 / SKILL-026: wording", () => {
  expect(noticeText(1)).toBe("1 Kolux skill has an update.");
  expect(noticeText(3)).toBe("3 Kolux skills have updates.");
  expect(chipTone("unrecognised")).toBe("warn");
  expect(chipTone("duplicate")).toBe("info");
  expect(chipTone("current")).toBe("info");
});

const st = (over: Partial<UpdateStatus>): UpdateStatus => ({ state: "done", names: [], command: "", log: "", code: 0, stopped: false, error: null, results: [], ...over });
const ok = (name: string) => ({ name, ok: true, reason: null });
const bad = (name: string) => ({ name, ok: false, reason: "The copy is still out of date" });

test("SKILL-026: the finished run is summed up from the rescan, not the exit code", () => {
  expect(sumUpRun(st({ results: [ok("a")] }))).toBe("Updated 1 skill.");
  expect(sumUpRun(st({ results: [ok("a"), ok("b")] }))).toBe("Updated 2 skills.");
  expect(sumUpRun(st({ code: 0, results: [bad("a")] }))).toContain("did not change anything");
  expect(sumUpRun(st({ results: [ok("a"), bad("b")] }))).toBe("Updated 1, 1 still out of date. Show log has the installer's output.");
  expect(sumUpRun(st({ stopped: true, code: null, results: [bad("a")] }))).toBe("Stopped. Nothing was updated.");
  expect(sumUpRun(st({ stopped: true, code: null, results: [ok("a"), bad("b")] }))).toBe("Stopped. 1 updated, 1 not.");
  expect(sumUpRun(st({ error: "Node.js was not found", results: [bad("a")] }))).toBe("Node.js was not found");
});

test("after-list row 62: the notice waits for settings and is claimed once per session by whichever screen asks first", () => {
  resetNoticeClaim();
  expect(claimNotice(checked(), false)).toBe(false); // settings not loaded: not claimed either
  expect(claimNotice(checked(), true)).toBe(true);
  expect(claimNotice(checked(), true)).toBe(false); // the Skills page asking later gets nothing
  resetNoticeClaim();
});
