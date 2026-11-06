import { expect, test } from "vitest";
import { allReady, clearMissing, defaultCopies, emptySeat, modelArgs, modelsFor, openingPrompt, pickShape, resizeLineup, resizeSeats, ROLE_BRIEFS, rulesBlock, sameForAll, seatReady, sharedWarning, TERMINAL, withoutFailed, withoutRules, saveShape, renameShape, restoreShape, SHAPE_LIMITS, type SavedShape, type Seat, applyLineup, FAST_SETTINGS, lineupAgents, lineupOf, offeredLineup, seatArgs, removeTarget, seatFolder, setDiscovered } from "./seats";

const claude: Seat = { agent: "claude", model: "opus" };
const term: Seat = { agent: TERMINAL, model: null };

test("SESS-013: three seats then two keeps the first two untouched; the free field can say 15; never below one", () => {
  const three = resizeSeats([claude], 3);
  expect(three).toEqual([claude, emptySeat(), emptySeat()]);
  const two = resizeSeats([claude, term, { agent: "codex", model: null }], 2);
  expect(two).toEqual([claude, term]);
  expect(resizeSeats([claude], 15)).toHaveLength(15);
  expect(resizeSeats([claude], 15).slice(1).every((s) => s.agent === null && s.model === null)).toBe(true);
  expect(resizeSeats([claude, term], 0)).toEqual([claude]);
  expect(resizeSeats([claude, term], Number.NaN)).toEqual([claude]);
  expect(resizeSeats([claude], 2.9)).toHaveLength(2);
});

test("SESS-007: an AI needs an explicit model, a terminal is ready at once, Start waits for every seat", () => {
  expect(seatReady({ agent: "claude", model: null })).toBe(false);
  expect(seatReady(claude)).toBe(true);
  expect(seatReady({ agent: "codex", model: "default" })).toBe(true);
  expect(seatReady(term)).toBe(true);
  expect(seatReady(emptySeat())).toBe(false);
  expect(allReady([claude, term])).toBe(true);
  expect(allReady([claude, emptySeat()])).toBe(false);
  expect(allReady([])).toBe(false);
});

test("SESS-015: Same for all copies the first finished seat's AI and model, keeps titles, and does nothing while no seat is finished", () => {
  const seats: Seat[] = [{ agent: "claude", model: null }, claude, { agent: null, model: null, title: "Review" }];
  expect(sameForAll(seats)).toEqual([{ agent: "claude", model: "opus" }, claude, { agent: "claude", model: "opus", title: "Review" }]);
  expect(allReady(sameForAll(seats))).toBe(true);
  const blank = [emptySeat(), { agent: "codex", model: null }];
  expect(sameForAll(blank)).toBe(blank);
});

test("SESS-024: a failed pane is dropped; the lineup counts as gone when none of its panes is left", () => {
  const panes = [{ key: 1 }, { key: 2, batch: 7 }, { key: 3, batch: 7 }];
  const one = withoutFailed(panes, 2);
  expect(one.panes.map((p) => p.key)).toEqual([1, 3]);
  expect(one.batchEmpty).toBe(false);
  const two = withoutFailed(one.panes, 3);
  expect(two.panes.map((p) => p.key)).toEqual([1]);
  expect(two.batchEmpty).toBe(true);
  expect(withoutFailed(panes, 1).batchEmpty).toBe(false);
});

test("a pick that stops being detected is cleared rather than swapped", () => {
  const seats = [claude, term, { agent: "grok", model: "grok-4" }];
  expect(clearMissing(seats, ["claude", "codex"])).toEqual([claude, term, emptySeat()]);
});

test("an agent with a built-in list gets the program default as an explicit choice; only a real model adds --model", () => {
  expect(modelsFor("claude").map((m) => m.id)).toEqual(["opus", "sonnet", "haiku", "default"]);
  // ACCT-032: built-in lists for Claude, Codex, Grok, Gemini and Cursor; any other agent skips the model step
  for (const a of ["codex", "grok", "gemini", "cursor"]) expect(modelsFor(a).slice(-1)[0]?.id).toBe("default");
  expect(modelsFor("aider")).toEqual([]);
  expect(seatReady({ agent: "aider", model: null })).toBe(true);
  expect(seatReady({ agent: "codex", model: null })).toBe(false);
  expect(modelArgs("opus")).toEqual(["--model", "opus"]);
  expect(modelArgs("default")).toEqual([]);
  expect(modelArgs(null)).toEqual([]);
});

test("SESS-014 (owner change 2026-11-05): every launch shares the project folder; sharing in Git with 2+ seats warns", () => {
  expect(defaultCopies(3, true)).toBe("shared");
  expect(defaultCopies(1, true)).toBe("shared");
  expect(defaultCopies(3, false)).toBe("shared");
  expect(sharedWarning("shared", 3, true)).toBe(true);
  expect(sharedWarning("separate", 3, true)).toBe(false);
  expect(sharedWarning("shared", 1, true)).toBe(false);
  expect(sharedWarning("shared", 3, false)).toBe(false);
});

test("SESS-013: every seat opens in the chooser's own folder, so a whole lineup lands in one grid", () => {
  expect(seatFolder("C:\\work\\shop", "C:\\work\\shop")).toBe("C:\\work\\shop");
  // A chooser opened in a workspace folder keeps that folder even when the project folder differs.
  expect(seatFolder("C:\\work\\shop-ws", "C:\\work\\shop")).toBe("C:\\work\\shop-ws");
  // Home has no folder: the project's own folder is used.
  expect(seatFolder(null, "C:\\work\\shop")).toBe("C:\\work\\shop");
  expect(seatFolder(null, null)).toBeNull();
});

test("SESS-012: Swarm gives five seats labelled scout, builder, builder, tester, reviewer; more seats wrap round", () => {
  const swarm = pickShape("swarm", [claude]);
  expect(swarm.map((s) => s.role)).toEqual(["scout", "builder", "builder", "tester", "reviewer"]);
  expect(swarm[0]).toMatchObject(claude);
  const grown = resizeLineup("swarm", swarm, 7);
  expect(grown.shape).toBe("swarm");
  expect(grown.seats.map((s) => s.role)).toEqual(["scout", "builder", "builder", "tester", "reviewer", "scout", "builder"]);
  expect(pickShape("custom", swarm).every((s) => s.role === undefined)).toBe(true);
  expect(pickShape("custom", swarm)).toHaveLength(5);
});

test("SESS-012: Workbench then a count of 2 reads Custom with no roles; Pair raised to 3 stays Pair", () => {
  const bench = pickShape("workbench", [claude]);
  expect(bench.map((s) => s.role)).toEqual(["scout", "builder", "reviewer"]);
  const two = resizeLineup("workbench", bench, 2);
  expect(two.shape).toBe("custom");
  expect(two.seats).toHaveLength(2);
  expect(two.seats.every((s) => s.role === undefined)).toBe(true);
  const three = resizeLineup("pair", pickShape("pair", [claude]), 3);
  expect(three.shape).toBe("pair");
  expect(three.seats.map((s) => s.role)).toEqual(["builder", "reviewer", "builder"]);
});

test("SESS-012: the first message is the role brief, then the shared task, then the seat prompt; the brief alone with no task", () => {
  const reviewer: Seat = { ...claude, role: "reviewer" };
  expect(openingPrompt(reviewer, "Fix the login page", null)).toBe(`${ROLE_BRIEFS.reviewer}\n\nFix the login page`);
  expect(openingPrompt(reviewer, "  ", null)).toBe(ROLE_BRIEFS.reviewer);
  expect(openingPrompt({ ...reviewer, prompt: "Look at auth first" }, "Fix it", null)).toBe(`${ROLE_BRIEFS.reviewer}\n\nFix it\n\nLook at auth first`);
  expect(openingPrompt(claude, "", null)).toBe("");
});

test("SESS-025: the rules block follows the task, names the note, and is cut off wherever the prompt is shown", () => {
  const rules = rulesBlock("C:\src\shop\.kolux\handoffs\gentle-squid.md");
  for (const words of ["alongside", "project folder", "pull request", "handoff note", "C:\src\shop\.kolux\handoffs\gentle-squid.md", "documentation"]) expect(rules).toContain(words);
  const full = openingPrompt({ ...claude, role: "builder" }, "Fix the login page", rules);
  expect(full.startsWith(`${ROLE_BRIEFS.builder}\n\nFix the login page\n\n`)).toBe(true);
  expect(full.endsWith(rules)).toBe(true);
  expect(withoutRules(full)).toBe(`${ROLE_BRIEFS.builder}\n\nFix the login page`);
  expect(withoutRules("Fix it")).toBe("Fix it");
  expect(openingPrompt(claude, "", rules)).toBe("");
});

test("SESS-020: a saved lineup keeps every seat, numbers a clashing name and keeps to its limits", () => {
  const pair = pickShape("pair", [claude, { agent: "codex", model: "default", title: "Checker", prompt: "look hard" }]);
  expect(saveShape([], "Review crew", [claude, emptySeat()], "separate", "")).toEqual({ error: expect.stringContaining("every seat") });
  expect(saveShape([], "   ", pair, "separate", "")).toEqual({ error: expect.stringContaining("name") });
  const one = saveShape([], "  Review crew ", pair, "separate", "fix the login");
  if (!("list" in one)) throw new Error("not saved");
  expect(one.list).toEqual([{ name: "Review crew", seats: pair, copies: "separate", task: "fix the login" }]);
  const two = saveShape(one.list, "REVIEW CREW", pair, "shared", "");
  const three = "list" in two ? saveShape(two.list, "review crew", pair, "shared", "") : two;
  expect("list" in three && three.list.map((x) => x.name)).toEqual(["Review crew", "REVIEW CREW 2", "review crew 3"]);
  const long = saveShape([], "x".repeat(80), pair, "shared", "p".repeat(5000));
  expect("list" in long && [long.list[0].name.length, long.list[0].task?.length]).toEqual([SHAPE_LIMITS.name, SHAPE_LIMITS.prompt]);
  expect(saveShape([], "big", Array.from({ length: 13 }, () => claude), "shared", "")).toEqual({ error: expect.stringContaining("12") });
  const full: SavedShape[] = Array.from({ length: 40 }, (_, i) => ({ name: "s" + i, seats: [claude], copies: "shared" }));
  expect(saveShape(full, "one more", [claude], "shared", "")).toEqual({ error: expect.stringContaining("40") });
  // renaming: blank does nothing, a clash with another gets a number, only that shape changes
  const list = "list" in three ? three.list : [];
  expect(renameShape(list, 1, "  ")).toBe(list);
  expect(renameShape(list, 1, "review CREW").map((x) => x.name)).toEqual(["Review crew", "review CREW 2", "review crew 3"]);
  expect(renameShape(list, 0, "Review Crew").map((x) => x.name)).toEqual(["Review Crew", "REVIEW CREW 2", "review crew 3"]);
  // restoring never swaps an AI: a seat whose agent is gone comes back blank
  expect(restoreShape(list[0], ["claude", "codex"])).toEqual(pair);
  expect(restoreShape(list[0], ["claude"])).toEqual([pair[0], emptySeat()]);
});

test("SESS-008: remove closes the newest chooser silently, then the focused session (asking), never the last chooser", () => {
  const running = { key: 1 };
  const chooser = { key: 2, seats: [emptySeat()] };
  expect(removeTarget([running, chooser], 1)).toEqual({ key: 2, chooser: true });
  expect(removeTarget([running], 1)).toEqual({ key: 1, chooser: false });
  expect(removeTarget([running, { key: 3 }], 9)).toEqual({ key: 3, chooser: false });
  expect(removeTarget([chooser], 2)).toBeNull();
  expect(removeTarget([], 1)).toBeNull();
});

test("SESS-002: a seat whose agent is gone or switched off is emptied, not swapped", () => {
  const seats: Seat[] = [{ agent: "claude", model: "opus" }, { agent: "codex", model: "default" }, { agent: TERMINAL, model: null }];
  const after = clearMissing(seats, ["claude"]);
  expect(after[0]).toBe(seats[0]);
  expect(after[1]).toEqual(emptySeat());
  expect(after[2]).toBe(seats[2]);
  expect(allReady(after)).toBe(false);
});

test("SESS-016: a seat's effort and fast mode reach its start line only when its model offers them", () => {
  expect(seatArgs({ agent: "claude", model: "opus", effort: "xhigh", fast: true })).toEqual(["--model", "opus", "--effort", "xhigh", "--settings", FAST_SETTINGS]);
  expect(seatArgs({ agent: "claude", model: "haiku", effort: "high", fast: true })).toEqual(["--model", "haiku"]);
  expect(seatArgs({ agent: "claude", model: "opus" })).toEqual(["--model", "opus"]);
  expect(seatArgs({ agent: "claude", model: "default", effort: "high" })).toEqual([]);
});

test("SESS-021: a lineup keeps shape, folders and each seat's agent and model, never options or prompts", () => {
  const seats: Seat[] = [{ agent: "codex", model: "gpt-5", prompt: "x", role: "builder" }, { agent: "claude", model: "opus", effort: "max", title: "T", role: "reviewer" }];
  const l = lineupOf("pair", "separate", seats);
  expect(l).toEqual({ shape: "pair", copies: "separate", seats: [{ agent: "codex", model: "gpt-5" }, { agent: "claude", model: "opus" }] });
  expect(lineupAgents(l)).toEqual(["codex", "claude"]);
  expect(offeredLineup(l, ["claude"])).toBe(l);
  expect(offeredLineup(l, ["gemini"])).toBeNull();
  expect(offeredLineup(undefined, ["claude"])).toBeNull();
  expect(offeredLineup({ shape: "odd", seats: [] }, ["claude"])).toBeNull();
  const back = applyLineup(l, ["claude"]);
  expect(back.shape).toBe("pair");
  expect(back.seats).toEqual([{ agent: null, model: null, role: "builder" }, { agent: "claude", model: "opus", role: "reviewer" }]);
});

test("SESS-029: Grok's discovered list replaces the built-in one and offers efforts up to extra-high, flag after the model", () => {
  setDiscovered("grok", [{ id: "grok-5-preview", label: "Grok 5 Preview" }]);
  const ids = modelsFor("grok").map((m) => m.id);
  expect(ids).toEqual(["grok-5-preview", "default"]);
  expect(modelsFor("grok")[0].efforts).toEqual(["low", "medium", "high", "xhigh"]);
  expect(modelsFor("grok")[0].defaultEffort).toBe("high");
  expect(seatArgs({ agent: "grok", model: "grok-5-preview", effort: "xhigh" } as never)).toEqual(["--model", "grok-5-preview", "--effort", "xhigh"]);
  expect(seatArgs({ agent: "grok", model: "grok-5-preview" } as never)).toEqual(["--model", "grok-5-preview"]);
});

test("SESS-029: an unreadable or empty answer leaves the list as it was", () => {
    const before = modelsFor("cursor").map((m) => m.id);
  setDiscovered("cursor", null);
  setDiscovered("cursor", []);
  expect(modelsFor("cursor").map((m) => m.id)).toEqual(before);
});

test("SESS-029: Cursor's discovered models join after its built-in ones, each once", () => {
  setDiscovered("cursor", [{ id: "auto", label: "Auto" }, { id: "composer-2", label: "Composer 2" }]);
  expect(modelsFor("cursor").map((m) => m.id)).toEqual(["auto", "sonnet-4.5", "gpt-5", "composer-2", "default"]);
});
