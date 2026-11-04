import { expect, test } from "vitest";
import { runsKey, failedLoad, deleteWords, hermesEdit, scheduleChanged, confirmDelete, keepSelection, runActions, runStep, pageKey, dashboardRows, onScreen, outputNote, RUN_BATCH, runTiles, findNext, lastRun, agentChoices, canDo, rowActions, splitWarnings, whereItRuns, matches, normalizeQuery, noFilters, passes, preselect, PROMPT_SEARCH_CHARS, sortRows, statusWord, triggerLabel, upcoming, GRACE, graceWord, PRECHECK, precheckWord, type Automation, type Names, type Run } from "./model";

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
  expect(runActions(r({ ...wt, status: "dispatched" }), { live: true, exists: true })).toEqual(["view", "cancel"]);
  expect(runActions(r({ ...wt, status: "completed" }), { live: false, exists: true })).toEqual(["resume"]);
  expect(runActions(r({ ...wt, worktreeGone: true }), { live: false, exists: true })).toEqual(["snapshot"]);
  expect(runActions(r({ ...wt, status: "failed" }), { live: false, exists: true })).toEqual(["resume", "rerun"]);
  expect(runActions(r({ status: "failed" }), { live: false, exists: false })).toEqual([]);
  // Skipped runs, and runs that never got a workspace, show their details only.
  expect(runActions(r({ status: "skipped", cause: "precheck" }), { live: false, exists: true })).toEqual([]);
  expect(runActions(r({ status: "failed" }), { live: false, exists: true })).toEqual(["rerun"]);
});

// C25-R2-01: a run whose agent stopped working without its process ending used to read Running
// for ever, with no action that could end it. Cancel is offered on a live run, and a cancelled run
// says so instead of reading as a plain failure.
test("c25r201_a_live_run_can_be_cancelled_and_a_cancelled_run_says_so", () => {
  const r = (o: Partial<Run>): Run => ({ ...run("a", 1), ...o });
  expect(runActions(r({ status: "dispatched" }), { live: true, exists: true })).toEqual(["cancel"]);
  expect(runActions(r({ status: "dispatched" }), { live: false, exists: true })).toEqual([]);
  expect(statusWord(r({ status: "failed", cancelled: true, dispatchedAt: 1 }))).toBe("Cancelled");
  expect(statusWord(r({ status: "failed", dispatchedAt: 1 }))).toBe("Failed");
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

// T-193-b: Hermes and OpenClaw rows live on this computer; Kolux does not own their agent or their runs.
const hermes = (extra: Partial<Automation> = {}): Automation => auto("hermes:j1", "Nightly digest", { provider: "hermes", projectId: "", source: "hermes", jobId: "j1", local: true, actions: ["run", "edit", "delete", "create", "pause", "resume"], ...extra });
const claw = (extra: Partial<Automation> = {}): Automation => auto("openclaw:c1", "Sweep", { provider: "openclaw", projectId: "", source: "openclaw", jobId: "c1", local: true, actions: ["run", "delete", "pause", "resume"], ...extra });

test("T-193-b an agent filter does not list or keep external rows, and no filter keeps them", () => {
  expect(passes(hermes(), noFilters, [])).toBe(true);
  expect(passes(hermes(), { ...noFilters, agents: ["claude"] }, [])).toBe(false);
  expect(passes(hermes(), { ...noFilters, agents: ["hermes"] }, [])).toBe(false);
  expect(agentChoices([auto("a", "A"), hermes(), claw()])).toEqual(["claude"]);
});

test("T-193-b state filter still works on external rows; a result filter reads the tool's own last status", () => {
  expect(passes(hermes({ enabled: false }), { ...noFilters, state: "paused" }, [])).toBe(true);
  expect(passes(hermes({ enabled: false }), { ...noFilters, state: "on" }, [])).toBe(false);
  const f = (result: typeof noFilters.result) => ({ ...noFilters, result });
  // never ran
  expect(passes(hermes(), f("never"), [])).toBe(true);
  expect(passes(hermes(), f("failed"), [])).toBe(false);
  // a failed Hermes job shows under Failed and nowhere else; an ok one under Completed
  const failed = hermes({ lastRunAt: 5, lastStatus: "error" });
  expect(passes(failed, f("failed"), [])).toBe(true);
  expect(passes(failed, f("completed"), [])).toBe(false);
  expect(passes(failed, f("never"), [])).toBe(false);
  const ok = claw({ lastRunAt: 5, lastStatus: "ok" });
  expect(passes(ok, f("completed"), [])).toBe(true);
  expect(passes(ok, f("failed"), [])).toBe(false);
  expect(passes(hermes({ lastRunAt: 5, lastStatus: "Failed" }), f("failed"), [])).toBe(true);
  // a status Kolux does not know matches no specific result, but "any result" still keeps it
  const odd = hermes({ lastRunAt: 5, lastStatus: "weird" });
  expect(passes(odd, f("failed"), [])).toBe(false);
  expect(passes(odd, noFilters, [])).toBe(true);
});

test("T-193-b which actions a row offers: Kolux rows everything, Hermes can be edited, OpenClaw cannot", () => {
  expect(canDo(auto("a", "A"), "edit")).toBe(true);
  expect(canDo(hermes(), "edit")).toBe(true);
  expect(canDo(hermes(), "create")).toBe(true);
  expect(canDo(claw(), "edit")).toBe(false);
  expect(canDo(claw(), "pause")).toBe(true);
  expect(canDo(claw(), "delete")).toBe(true);
  expect(canDo(hermes({ actions: ["run"] }), "pause")).toBe(false);
});

test("T-193-b warning rows are split off the list and read as one line each", () => {
  const w: Automation = { ...auto("warning:hermes", "hermes"), kind: "warning", source: "hermes", warning: "hermes failed: boom", actions: [] };
  const { rows, warnings } = splitWarnings([auto("a", "A"), w, hermes()]);
  expect(rows.map((r) => r.id)).toEqual(["a", "hermes:j1"]);
  expect(warnings).toEqual(["hermes failed: boom"]);
});

test("T-193-b external rows sort by their own last run time and say where they run", () => {
  const list = [hermes({ id: "h1", name: "H old", lastRunAt: 1000 }), hermes({ id: "h2", name: "H new", lastRunAt: 5000 }), hermes({ id: "h3", name: "H never" })];
  expect(sortRows(list, [], "lastRun", false, names).map((a) => a.id)).toEqual(["h2", "h1", "h3"]);
  expect(whereItRuns(hermes())).toBe("Runs on this computer (Hermes)");
  expect(whereItRuns(claw())).toBe("Runs on this computer (OpenClaw)");
  expect(whereItRuns(auto("a", "A"))).toBe("");
});

test("T-193-b the quick-action menu: Hermes rows have Edit, OpenClaw rows do not, a paused row offers Resume, Kolux rows have all four", () => {
  expect(rowActions(auto("a", "A"))).toEqual(["run", "toggle", "edit", "delete"]);
  expect(rowActions(hermes())).toEqual(["run", "toggle", "edit", "delete"]);
  expect(rowActions(claw())).toEqual(["run", "toggle", "delete"]);
  expect(rowActions(claw({ enabled: false, actions: ["run", "delete", "pause"] }))).toEqual(["run", "delete"]);
});

// T-193-b: Edit on a Hermes job sends only what the user changed.
const cronJob = (cron: string, form: Automation["form"]) => hermes({ prompt: "summarise", trigger: { kind: "schedule", cron, timezone: "UTC" }, form });
const every30 = cronJob("*/30 * * * *", { preset: "custom", time: "", day: null, custom: "*/30 * * * *" });

test("T-193-b changing only the name sends no schedule and no prompt", () => {
  const sent = hermesEdit(every30, { name: "Renamed", prompt: "summarise", form: every30.form!, cron: "*/30 * * * *" });
  expect(sent).toEqual({ name: "Renamed" });
  expect("schedule" in sent).toBe(false);
});

test("T-193-b nothing changed sends nothing, and the schedule is sent only once its fields moved", () => {
  expect(hermesEdit(every30, { name: "Nightly digest", prompt: " summarise ", form: every30.form!, cron: "*/30 * * * *" })).toEqual({});
  const moved = { ...every30.form!, custom: "*/15 * * * *" };
  expect(scheduleChanged(every30, moved)).toBe(true);
  expect(hermesEdit(every30, { name: "Nightly digest", prompt: "summarise", form: moved, cron: "*/15 * * * *" })).toEqual({ schedule: "*/15 * * * *" });
  // moved to something that is not a cron line: nothing to send
  expect(hermesEdit(every30, { name: "Nightly digest", prompt: "summarise", form: moved, cron: null })).toEqual({});
});

test("T-193-b a job whose timetable is not cron never has a schedule sent", () => {
  const interval = hermes({ prompt: "tick", trigger: { kind: "schedule", cron: "", timezone: "" }, timetable: "every 120m" });
  expect(interval.form).toBeUndefined();
  // whatever the dialog's (default, hidden) fields say, the schedule stays out
  const sent = hermesEdit(interval, { name: "New name", prompt: "tick", form: { preset: "weekdays", time: "09:00", day: 1, custom: "" }, cron: "0 9 * * 1-5" });
  expect(sent).toEqual({ name: "New name" });
  expect(scheduleChanged(interval, { preset: "daily", time: "10:00", day: null, custom: "" })).toBe(false);
});

test("UX2: Escape on the Runs dashboard steps back, on a run page it goes to Runs, and never over a field, pop-up or modifier", () => {
  const k = (o: Partial<Parameters<typeof runsKey>[0]> = {}) => runsKey({ key: "Escape", mods: false, field: false, overlay: false, run: false, ...o });
  expect(k()).toBe("runs");
  expect(k({ run: true })).toBe("run");
  expect(k({ field: true })).toBeNull();
  expect(k({ overlay: true })).toBeNull();
  expect(k({ mods: true })).toBeNull();
  expect(runsKey({ key: "Enter", mods: false, field: false, overlay: false, run: false })).toBeNull();
});

test("UX2: a failed list read keeps the rows with a note, and is the page error only with nothing shown", () => {
  expect(failedLoad(true, "disk")).toEqual({ error: null, note: "Could not refresh the list: disk" });
  expect(failedLoad(false, "disk")).toEqual({ error: "disk", note: null });
});

test("UX2: the delete words name Hermes or OpenClaw for their jobs and the run history for Kolux ones", () => {
  expect(deleteWords({ name: "A" })).toEqual({ title: "Delete A?", body: "Its run history goes with it." });
  expect(deleteWords({ name: "B", source: "hermes" }).body).toContain("from Hermes itself");
  expect(deleteWords({ name: "C", source: "openclaw" }).body).toContain("from OpenClaw itself");
  expect(deleteWords(undefined).title).toBe("Delete this automation?");
});

import { closesOnScrim, holdWhile, joinNotes } from "./model";

test("UX-T671: the scrim closes the dialog only when the press and the release were both on it", () => {
  expect(closesOnScrim(true, true)).toBe(true);
  expect(closesOnScrim(true, false)).toBe(false); // pressed on the scrim, released inside the dialog
  expect(closesOnScrim(false, true)).toBe(false); // pressed inside, released on the scrim
  expect(closesOnScrim(false, false)).toBe(false);
});

test("UX-T671: Refresh shows the failed ask and the failed list read together, not only the last", () => {
  const ask = "Hermes and OpenClaw could not be asked again: offline";
  const list = failedLoad(true, "disk busy").note;
  expect(joinNotes(ask, list)).toBe(`${ask} ${list}`);
  expect(joinNotes(ask, null)).toBe(ask);
  expect(joinNotes(null, list)).toBe(list);
  expect(joinNotes(null, undefined, "")).toBeNull();
});

test("UX-T671: Run now holds an automation while its ask is on the way and lets it go on success and on failure", async () => {
  let list: string[] = [];
  const set = (change: (l: string[]) => string[]) => {
    list = change(list);
  };
  let finish!: () => void;
  const slow = holdWhile(set, "a", () => new Promise<void>((done) => (finish = done)));
  expect(list).toEqual(["a"]);
  finish();
  await slow;
  expect(list).toEqual([]);
  list = ["b"];
  await holdWhile(set, "a", () => Promise.reject(new Error("no")));
  expect(list).toEqual(["b"]);
});
