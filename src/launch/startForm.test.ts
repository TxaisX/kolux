import { expect, test } from "vitest";
import { MAX_PANES } from "../terminal/grid";
import { emptySeat, lineupOf, MAX_SESSIONS, TERMINAL, type Seat } from "./seats";
import { acrossNote, startEach, askAtOpen, asksAtStart, everySeatStart, folderPlan, lastStart, oneForAll, pickForAll, pickWords, prefill, recentFirst, recountAll, setAll, startSummary, stripAsk, START_ASK_KEY, LAST_START_KEY, START_WAIT_MS } from "./startForm";

const D = { model: "opus", effort: "high" };
const none = { model: null };
const opus: Seat = { agent: "claude", model: "opus", effort: "high" };

test("Start form A: the one row shows the shared pick, or Mixed when seats differ", () => {
  expect(oneForAll([opus, { ...opus, role: "builder", title: "x" }])).toEqual({ agent: "claude", model: "opus", effort: "high", fast: undefined });
  expect(oneForAll([opus, { ...opus, effort: "low" }])).toBe("mixed");
  expect(oneForAll([opus, { ...opus, fast: true }])).toBe("mixed");
  expect(oneForAll([emptySeat(), emptySeat()])).toEqual({ agent: null, model: null, effort: undefined, fast: undefined });
});

test("Start form A: the one row sets every seat and keeps roles, titles and prompts", () => {
  const seats: Seat[] = [{ agent: "codex", model: "gpt-5", role: "builder", title: "B", prompt: "p" }, emptySeat()];
  const all = setAll(seats, { agent: "claude", model: "sonnet", effort: "low" });
  expect(all).toEqual([
    { agent: "claude", model: "sonnet", effort: "low", fast: undefined, role: "builder", title: "B", prompt: "p" },
    { agent: "claude", model: "sonnet", effort: "low", fast: undefined },
  ]);
  expect(oneForAll(all)).not.toBe("mixed");
  // Picking an AI starts every seat on the default model and effort; Terminal needs no model.
  expect(pickForAll([opus, { ...opus, effort: "low" }], "claude", D, none).every((s) => s.model === "opus" && s.effort === "high")).toBe(true);
  expect(pickForAll([opus, opus], TERMINAL, D)).toEqual([{ agent: TERMINAL, model: null, effort: undefined, fast: undefined }, { agent: TERMINAL, model: null, effort: undefined, fast: undefined }]);
});

test("Start form A: blank seats all start on the installed default agent once; a picked seat stops it", () => {
  const agents = [{ id: "claude", installed: true }, { id: "codex", installed: false }];
  expect(everySeatStart([emptySeat(), emptySeat()], "claude", agents, D, none)?.map((s) => s.agent)).toEqual(["claude", "claude"]);
  expect(everySeatStart([emptySeat(), opus], "claude", agents, D, none)).toBeNull();
  expect(everySeatStart([emptySeat()], "codex", agents, D, none)).toBeNull();
  expect(everySeatStart([emptySeat()], "", agents, D, none)).toBeNull();
});

test("Start form C: the plan across folders, its 24 limit and each grid's room", () => {
  expect(folderPlan(6, [{ name: "kolux", used: 0 }])).toEqual({ total: 6, problem: null });
  expect(folderPlan(6, [{ name: "a", used: 0 }, { name: "b", used: 0 }])).toEqual({ total: 12, problem: null });
  expect(folderPlan(8, [{ name: "a", used: 0 }, { name: "b", used: 0 }, { name: "c", used: 0 }, { name: "d", used: 0 }]).problem).toMatch(/32 sessions is more than 24/);
  expect(folderPlan(MAX_SESSIONS, [{ name: "a", used: 0 }]).problem).toBeNull();
  expect(folderPlan(4, [{ name: "a", used: MAX_PANES - 2 }]).problem).toBe(`a has room for 2 more. A grid holds up to ${MAX_PANES}.`);
  expect(folderPlan(3, []).problem).toBe("Tick at least one folder.");
});

test("Start form C/H: the footer line says the total in plain words", () => {
  expect(startSummary(6, ["kolux"], ["Claude Code", "Opus", "High"])).toBe("6 sessions: Claude Code, Opus, High, in kolux");
  expect(startSummary(1, ["kolux"], ["plain terminal"])).toBe("1 session: plain terminal, in kolux");
  expect(startSummary(2, ["a", "b", "c"], ["Codex"])).toBe("6 sessions: Codex, 2 in each of a, b and c");
  expect(startSummary(3, [], [])).toBe("0 sessions");
  expect(pickWords({ agent: "claude", model: "opus", effort: "xhigh", fast: true }, () => "Claude Code", () => "Opus")).toEqual(["Claude Code", "Opus", "Xhigh", "fast"]);
  expect(pickWords("mixed", String, String)).toEqual(["each one different"]);
  expect(pickWords({ agent: null, model: null }, String, String)).toEqual([]);
});

test("Start form C: known folders list the most recently shown first", () => {
  const ps = [{ id: "a", path: "G:\\A" }, { id: "b", path: "G:\\B" }, { id: "c", path: "G:\\C" }];
  expect(recentFirst(ps, ["G:\\C\\wt", "G:\\B"]).map((p) => p.id)).toEqual(["c", "b", "a"]);
  expect(recentFirst(ps, []).map((p) => p.id)).toEqual(["a", "b", "c"]);
});

test("Start form D: asked once, first window only, after settings and the agent search, unless off or busy", () => {
  const w = { on: true, firstWindow: true, asked: false, settingsRead: true, agentsDone: true, launching: false, sheetOpen: false };
  expect(askAtOpen(w)).toBe("ask");
  expect(askAtOpen({ ...w, settingsRead: false })).toBe("wait");
  expect(askAtOpen({ ...w, agentsDone: false })).toBe("wait");
  expect(askAtOpen({ ...w, asked: true })).toBe("skip");
  expect(askAtOpen({ ...w, firstWindow: false })).toBe("skip");
  expect(askAtOpen({ ...w, on: false })).toBe("skip");
  expect(askAtOpen({ ...w, launching: true })).toBe("skip");
  expect(askAtOpen({ ...w, sheetOpen: true })).toBe("skip");
  // D-15: while the first-run screens are up they do the asking; the form never asks a second time.
  expect(askAtOpen({ ...w, firstRun: true })).toBe("skip");
  expect(asksAtStart({})).toBe(true);
  expect(asksAtStart({ [START_ASK_KEY]: false })).toBe(false);
});

test("job 47: past the limit the three waits give way and every skip rule still holds", () => {
  const w = { on: true, firstWindow: true, asked: false, settingsRead: true, layoutIn: true, agentsDone: true, projectsRead: true, launching: false, sheetOpen: false, firstRunKnown: true, waitedOut: true };
  expect(START_WAIT_MS).toBe(5000);
  for (const stuck of [{ layoutIn: false }, { firstRunKnown: false }, { settingsRead: false }, { agentsDone: false }, { projectsRead: false }]) {
    expect(askAtOpen({ ...w, ...stuck, waitedOut: false })).toBe("wait");
    expect(askAtOpen({ ...w, ...stuck })).toBe("ask");
  }
  for (const skip of [{ asked: true }, { firstWindow: false }, { firstRun: true }, { agentsFailed: true }, { userActed: true }, { launching: true }, { sheetOpen: true }, { on: false }])
    expect(askAtOpen({ ...w, layoutIn: false, settingsRead: false, agentsDone: false, ...skip })).toBe("skip");
});

test("Start form E: the layout strip asks once for the cells it adds", () => {
  expect(stripAsk(5)).toBe(5);
  expect(stripAsk(0)).toBe(0);
  expect(stripAsk(-2)).toBe(0);
  expect(stripAsk(99)).toBe(MAX_PANES);
});

test("Start form F: opens on the last Start's folders and count and the folder's last lineup", () => {
  const projects = [{ id: "kolux" }, { id: "brain" }];
  const lineup = lineupOf("custom", "shared", [opus, opus]);
  const last = lastStart({ [LAST_START_KEY]: { folders: ["brain", "gone"], count: 6 } });
  expect(last).toEqual({ folders: ["brain", "gone"], count: 6 });
  const f = prefill({ projects, last, lineup, installed: ["claude"] });
  expect(f.folders).toEqual(["brain"]);
  expect(f.seats).toHaveLength(6);
  expect(oneForAll(f.seats)).toEqual({ agent: "claude", model: "opus", effort: "high", fast: undefined });
  // A folder given (the project in front, the layout strip) and a count given win.
  expect(prefill({ projects, folders: ["kolux"], count: 3, last, lineup: null, installed: [] })).toEqual({ folders: ["kolux"], shape: "custom", seats: [emptySeat(), emptySeat(), emptySeat()] });
  // Nothing remembered: the first project, one blank seat. No project: no folder.
  expect(prefill({ projects, last: null, lineup: null, installed: [] })).toEqual({ folders: ["kolux"], shape: "custom", seats: [emptySeat()] });
  expect(prefill({ projects: [], last: null, lineup: null, installed: [] }).folders).toEqual([]);
  // A lineup whose agents are all gone gives blank seats; bad saved values are ignored or clamped.
  expect(prefill({ projects, last: null, lineup, installed: [] }).seats.every((s) => s.agent === null)).toBe(true);
  expect(lastStart({ [LAST_START_KEY]: { folders: "x", count: 2 } })).toBeNull();
  expect(lastStart({ [LAST_START_KEY]: { folders: [], count: 99 } })?.count).toBe(MAX_SESSIONS);
});

test("wave 2 item 2: a refused folder between two good ones does not stop the third; one line says what happened", async () => {
  const tried: string[] = [];
  const results = await startEach([{ name: "kolux" }, { name: "Txais Brain" }, { name: "site" }], 2, async (f) => {
    tried.push(f.name);
    return f.name === "Txais Brain" ? "Error: Txais Brain asks about setup for each new workspace, so it cannot be bulk-launched." : null;
  });
  expect(tried).toEqual(["kolux", "Txais Brain", "site"]);
  expect(results.map((r) => r.error === null)).toEqual([true, false, true]);
  expect(acrossNote(results)).toBe("4 of 6 started. 2 need you. Txais Brain did not start: Txais Brain asks about setup for each new workspace, so it cannot be bulk-launched.");
  // A thrown failure is caught and named too; every folder started means no line; one folder says its own reason only.
  const thrown = await startEach([{ name: "a" }, { name: "b" }], 1, async (f) => {
    if (f.name === "a") throw new Error("a is gone");
    return null;
  });
  expect(acrossNote(thrown)).toBe("1 of 2 started. 1 needs you. a did not start: a is gone");
  expect(acrossNote([{ name: "a", count: 3, error: null }])).toBeNull();
  expect(acrossNote([{ name: "a", count: 3, error: "A workspace holds up to 6 panes." }])).toBe("A workspace holds up to 6 panes.");
});

test("job 13 F2: a new How many keeps the one answer, up and back down; mixed seats are left as they were", async () => {
  const up = recountAll("custom", [opus], 4);
  expect(up.seats).toHaveLength(4);
  expect(up.seats.every((s) => s.agent === "claude" && s.model === "opus" && s.effort === "high")).toBe(true);
  expect(oneForAll(up.seats)).not.toBe("mixed");
  const { allReady } = await import("./seats");
  expect(allReady(up.seats)).toBe(true);
  const down = recountAll(up.shape, up.seats, 2);
  expect(down.seats).toHaveLength(2);
  expect(oneForAll(down.seats)).toEqual(oneForAll([opus]));
  // Seats that differ: the new seats stay blank, as before.
  const mixed = recountAll("custom", [opus, { ...opus, effort: "low" }], 3);
  expect(mixed.seats[2]).toEqual(emptySeat());
  // Nothing picked yet: blank seats stay blank.
  expect(recountAll("custom", [emptySeat()], 2).seats).toEqual([emptySeat(), emptySeat()]);
});

test("job 13 F2: the quick counts, the big-count button and the typed field all go through recountAll", async () => {
  const src = (await import("./ChooserPane.tsx?raw")).default;
  expect(src).toMatch(/const recount = \(n: number\) => \{[^}]*recountAll\(shape, seats, n\)/);
  expect(src).toContain("onClick={() => recount(n)}");
  expect(src).toContain("onClick={() => recount(bigCount)}");
  expect(src).toContain("else recount(plan.n);");
});
