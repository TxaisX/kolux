import { expect, test } from "vitest";
import { confirmDelete, keepSelection, runActions, runStep, pageKey, dashboardRows, onScreen, outputNote, RUN_BATCH, runTiles, findNext, lastRun, matches, normalizeQuery, noFilters, passes, preselect, PROMPT_SEARCH_CHARS, sortRows, statusWord, triggerLabel, upcoming, GRACE, graceWord, PRECHECK, precheckWord, type Automation, type Names, type Run } from "./model";

test("T-085-h a run reconnected after a restart says its output is the replay so far, not the end", () => {
  const r: Run = { id: "run-1", automationId: "a", number: 1, trigger: "schedule", status: "dispatched", at: 0, output: "hi", outputFrom: "replay", reconnected: true };
  expect(outputNote(r)).toBe("What the agent's terminal had shown when Kolux restarted. The run carries on in that terminal.");
  expect(outputNote({ ...r, outputCut: true })).toContain("older lines were left out. The run carries on");
  expect(outputNote({ ...r, status: "completed", outputFrom: "screen" })).toBe("What the agent's terminal showed when the run ended.");
  expect(outputNote({ ...r, status: "completed", outputFrom: "screen", outputCut: true })).toBe("The most recent text the agent's terminal showed; older lines were left out.");
  expect(outputNote({ ...r, status: "completed", outputFrom: "transcript" })).toBe("What the agent said during the run, from its transcript.");
  expect(outputNote({ ...r, status: "completed", outputFrom: "transcript", outputCut: true })).toBe("The most recent of what the agent said; older text was left out.");
});

const names: Names = { project: (id) => ({ p1: "shop", p2: "blog" })[id] ?? id, agent: (id) => ({ claude: "Claude Code", codex: "Codex" })[id] ?? id };
const auto = (id: string, name: string, extra: Partial<Automation> = {}): Automation => ({ id, name, prompt: "", provider: "claude", projectId: "p1", enabled: true, ...extra });
const run = (automationId: string, at: number, status: Run["status"] = "completed", number = 1): Run => ({ id: `r-${automationId}-${at}`, automationId, number, trigger: "manual", status, at });

test("names sort the way people count: 2 before 10, case ignored", () => {
  const list = [auto("a", "Run 10"), auto("b", "run 2"), auto("c", "Run 1")];
  expect(sortRows(list, [], "name", false, names).map((a) => a.name)).toEqual(["Run 1", "run 2", "Run 10"]);
  expect(sortRows(list, [], "name", true, names).map((a) => a.name)).toEqual(["Run 10", "run 2", "Run 1"]);
});

test("sort by last run: newest first, never-run automations at the end either way", () => {
  const list = [auto("never", "Never ran"), auto("old", "Old"), auto("new", "New")];
  const runs = [run("old", 1000), run("new", 5000), run("old", 2000, "failed", 2)];
  expect(sortRows(list, runs, "lastRun", false, names).map((a) => a.id)).toEqual(["new", "old", "never"]);
  expect(sortRows(list, runs, "lastRun", true, names).map((a) => a.id)).toEqual(["old", "new", "never"]);
  expect(lastRun("old", runs)?.status).toBe("failed");
});

test("search finds a word that appears only inside the prompt, within its first 2,048 characters", () => {
  const deep = auto("a", "Nightly", { prompt: "Check the  Flaky\tTests in CI" });
  const tooDeep = auto("b", "Late", { prompt: "x".repeat(PROMPT_SEARCH_CHARS) + " zebra" });
  const q = normalizeQuery("  flaky   TESTS ")!;
  expect(q).toBe("flaky tests");
  expect(matches(deep, q, names)).toBe(true);
  expect(matches(tooDeep, normalizeQuery("zebra")!, names)).toBe(false);
  expect(matches(deep, "shop", names)).toBe(true); // the project's name
  expect(matches(deep, "claude code", names)).toBe(true); // the agent's name
  expect(matches(auto("c", "x", { workspace: "C:\\ws\\shop\\jade-seal" }), "jade-seal", names)).toBe(true);
  expect(normalizeQuery("a".repeat(201))).toBeNull();
});

test("filters: on or paused, the last run's result, and several agents at once", () => {
  const list = [auto("a", "A"), auto("b", "B", { enabled: false, provider: "codex" }), auto("c", "C", { provider: "gemini" })];
  const runs = [run("a", 10, "failed"), run("b", 10, "completed")];
  const pick = (f: Partial<typeof noFilters>) => list.filter((a) => passes(a, { ...noFilters, ...f }, runs)).map((a) => a.id);
  expect(pick({ state: "paused" })).toEqual(["b"]);
  expect(pick({ state: "on" })).toEqual(["a", "c"]);
  expect(pick({ result: "failed" })).toEqual(["a"]);
  expect(pick({ result: "never" })).toEqual(["c"]);
  expect(pick({ agents: ["claude", "codex"] })).toEqual(["a", "b"]);
});

test("the delete confirmation is on unless switched off", () => {
  expect(confirmDelete({})).toBe(true);
  expect(confirmDelete({ confirmAutomationDelete: false })).toBe(false);
});

test("find in the prompt wraps round to the top and ignores case; the main worktree is preselected", () => {
  expect(findNext("Check tests, then TESTS again", "tests", 0)).toBe(6);
  expect(findNext("Check tests, then TESTS again", "tests", 7)).toBe(18);
  expect(findNext("Check tests, then TESTS again", "tests", 19)).toBe(6);
  expect(findNext("abc", "z", 0)).toBe(-1);
  expect(preselect([{ path: "a", isMain: false }, { path: "m", isMain: true }])).toBe("m");
  expect(preselect([{ path: "a", isMain: false }])).toBe("a");
  expect(preselect([])).toBe("");
});

test("the list shows the back end's timetable sentence and when it goes next", () => {
  const a = auto("a", "Morning", { trigger: { kind: "schedule", cron: "0 9 * * 1-5", timezone: "UTC" }, timetable: "Monday to Friday at 09:00 (UTC)", nextRunAt: 3 * 86400000, nextRunLabel: "Monday 09:00" });
  expect(triggerLabel(a)).toBe("Monday to Friday at 09:00 (UTC)");
  expect(upcoming(a, 0)).toBe("Monday 09:00 · in 3 days");
  expect(upcoming({ ...a, enabled: false }, 0)).toBe("Paused");
  expect(triggerLabel(auto("b", "Raw", { trigger: { kind: "schedule", cron: "5  4 * * *" } }))).toBe("Custom: 5 4 * * *");
});

// AUTO-015: the Runs dashboard across every automation.
test("AUTO-015: the status filter groups runs into in progress, successful, failed and skipped", () => {
  const all = [run("a", 1, "pending"), run("a", 2, "dispatching"), run("a", 3, "dispatched"), run("a", 4, "completed"), run("a", 5, "failed"), run("a", 6, "skipped")];
  const named = (id: string) => (id === "a" ? "Nightly" : id);
  expect(dashboardRows(all, named, "failed", "").map((r) => r.status)).toEqual(["failed"]);
  expect(dashboardRows(all, named, "progress", "").map((r) => r.status)).toEqual(["dispatched", "dispatching", "pending"]);
  expect(dashboardRows(all, named, "success", "").map((r) => r.status)).toEqual(["completed"]);
  expect(dashboardRows(all, named, "all", "").map((r) => r.at)).toEqual([6, 5, 4, 3, 2, 1]); // newest first
});

test("AUTO-015: search matches the automation's name and the run's words, case ignored", () => {
  const all = [run("a", 1, "completed"), run("b", 2, "failed")];
  const named = (id: string) => ({ a: "Nightly checks", b: "Weekly report" })[id] ?? id;
  expect(dashboardRows(all, named, "all", "WEEKLY").map((r) => r.automationId)).toEqual(["b"]);
  expect(dashboardRows(all, named, "all", "completed").map((r) => r.automationId)).toEqual(["a"]);
});

test("AUTO-015: the tiles count successes and failures over 24 hours and 7 days, future runs left out", () => {
  const now = 10 * 86400000;
  const h = 3600000;
  const all = [run("a", now - h, "completed"), run("a", now - 2 * h, "failed"), run("a", now - 3 * 86400000, "completed"), run("a", now - 8 * 86400000, "failed"), run("a", now + h, "completed"), run("a", now - h, "skipped")];
  expect(runTiles(all, now)).toEqual({ day: { ok: 1, failed: 1 }, week: { ok: 2, failed: 1 } });
});

test("AUTO-015: only the rows on screen are drawn, with a few spare either side", () => {
  expect(onScreen(0, 320, 32, 10000)).toEqual([0, 15]);
  expect(onScreen(32 * 5000, 320, 32, 10000)).toEqual([4995, 5015]);
  expect(onScreen(32 * 9995, 320, 32, 10000)).toEqual([9990, 10000]);
  expect(RUN_BATCH).toBe(100);
});

test("page keys: arrows, Enter and Escape act only outside fields, pop-ups and dialogs, with no modifier (AUTO-017)", () => {
  const k = (key: string, o: Partial<Parameters<typeof pageKey>[0]> = {}) => pageKey({ key, mods: false, control: false, search: false, row: false, overlay: false, opened: false, ...o });
  expect([k("ArrowUp"), k("ArrowDown"), k("Enter"), k("ArrowLeft"), k("ArrowRight"), k("Escape")]).toEqual(["up", "down", "open", "tab", "tab", "close"]);
  expect(k("Escape", { opened: true })).toBe("back");
  expect(k("Enter", { opened: true })).toBeNull();
  expect([k("ArrowDown", { search: true, control: true }), k("Enter", { search: true, control: true })]).toEqual(["down", "open"]);
  expect([k("Escape", { search: true, control: true }), k("ArrowLeft", { search: true, control: true })]).toEqual([null, null]);
  expect([k("ArrowDown", { control: true }), k("Enter", { control: true })]).toEqual([null, null]);
  expect([k("ArrowDown", { mods: true }), k("Escape", { overlay: true })]).toEqual([null, null]);
  expect([k(" "), k(" ", { row: true })]).toEqual([null, "open"]);
});

test("when the selected row vanishes the selection moves to the row beside it (AUTO-017)", () => {
  expect(keepSelection(["a", "b", "c"], "b", 1)).toBe("b");
  expect(keepSelection(["a", "c"], "b", 1)).toBe("c");
  expect(keepSelection(["a"], "c", 2)).toBe("a");
  expect(keepSelection([], "a", 0)).toBeNull();
  expect(keepSelection(["a", "b"], null, 0)).toBe("a");
});

test("AUTO-007 grace choices and why a run was skipped read in words", () => {
  expect(GRACE.map((g) => g[0])).toEqual([0, 30, 60, 180, 720, 1440, 2880]);
  expect(graceWord(0)).toBe("Skip it");
  expect(graceWord(180)).toBe("Start it up to 3 hours late");
  expect(graceWord(undefined)).toBe("Skip it");
  const r: Run = { id: "run-1", automationId: "a", number: 1, trigger: "schedule", status: "skipped", at: 0 };
  expect(statusWord({ ...r, cause: "missed" })).toBe("Skipped (Kolux was away)");
  expect(statusWord({ ...r, cause: "signin" })).toBe("Skipped (sign-in needed)");
  expect(statusWord({ ...r, cause: "unavailable" })).toBe("Skipped (unavailable)");
  // AUTO-012: the same refusal again and again is one entry with a count.
  expect(statusWord({ ...r, cause: "unavailable", repeats: 12 })).toBe("Skipped (unavailable) · 12 times");
  expect(statusWord({ ...r, cause: "unavailable", repeats: 1 })).toBe("Skipped (unavailable)");
  // AUTO-012 (T-072-b): a run handed to its agent that then stopped failed; it did not fail to start.
  expect(statusWord({ ...r, status: "failed" })).toBe("Failed to start");
  expect(statusWord({ ...r, status: "failed", dispatchedAt: 5 })).toBe("Failed");
  expect(statusWord({ ...r, status: "completed", dispatchedAt: 5 })).toBe("Completed");
});

test("AUTO-008 the precheck's limits and its skip read in words", () => {
  expect(PRECHECK.map((p) => p[0])).toEqual([60, 120, 300, 600]);
  expect(PRECHECK.map((p) => p[1])).toEqual(["1 minute", "2 minutes", "5 minutes", "10 minutes"]);
  const r: Run = { id: "run-1", automationId: "a", number: 1, trigger: "schedule", status: "skipped", at: 0, cause: "precheck" };
  expect(statusWord({ ...r, exitCode: 1 })).toBe("Skipped (precheck failed)");
  expect(statusWord({ ...r, timedOut: true })).toBe("Skipped (precheck timed out)");
  expect([precheckWord(undefined), precheckWord(300)]).toEqual(["1 minute", "5 minutes"]);
});

test("AUTO-013: a run offers View run while its terminal is live, Resume workspace after, its snapshot once the worktree is gone, and Rerun only when it failed", () => {
  const r = (o: Partial<Run>): Run => ({ ...run("a", 1), ...o });
  const wt = { worktree: "C:/w", worktreeName: "w" };
  expect(runActions(r({ ...wt, status: "dispatched" }), { live: true, exists: true })).toEqual(["view"]);
  expect(runActions(r({ ...wt, status: "completed" }), { live: false, exists: true })).toEqual(["resume"]);
  expect(runActions(r({ ...wt, worktreeGone: true }), { live: false, exists: true })).toEqual(["snapshot"]);
  expect(runActions(r({ ...wt, status: "failed" }), { live: false, exists: true })).toEqual(["resume", "rerun"]);
  expect(runActions(r({ status: "failed" }), { live: false, exists: false })).toEqual([]);
  // Skipped runs, and runs that never got a workspace, show their details only.
  expect(runActions(r({ status: "skipped", cause: "precheck" }), { live: false, exists: true })).toEqual([]);
  expect(runActions(r({ status: "failed" }), { live: false, exists: true })).toEqual(["rerun"]);
});

test("AUTO-013: Up and Down step through runs, Down with none selected picks the first, Enter opens; modifiers and composition do nothing", () => {
  const k = (key: string, at: number | null, o: { mods?: boolean; composing?: boolean } = {}) => runStep({ key, mods: false, composing: false, ...o }, at, 3);
  expect(k("ArrowDown", null)).toBe(0);
  expect(k("ArrowDown", 0)).toBe(1);
  expect(k("ArrowDown", 2)).toBe(2);
  expect(k("ArrowUp", 1)).toBe(0);
  expect(k("ArrowUp", 0)).toBe(0);
  expect(k("Enter", 1)).toBe("open");
  expect(k("Enter", null)).toBe(null);
  expect(k("ArrowDown", 0, { mods: true })).toBe(null);
  expect(k("ArrowDown", 0, { composing: true })).toBe(null);
  expect(runStep({ key: "ArrowDown", mods: false, composing: false }, null, 0)).toBe(null);
});
