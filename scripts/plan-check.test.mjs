import { describe, expect, it } from "vitest";
import {
  coverageErrors, cutlineLeft, doneLine, headCounts, mergeGate, p0Passing, parseCards, parseCutline,
  parseStrikes, planTasks, rewriteStateHead,
} from "./plan-check.mjs";

const SPEC = [
  "## Cards",
  "",
  "### AAA-001 · every box ticked",
  "Tier: P0 · Pushed: 1 · State at 0.15.0: live",
  "Rules: a rule.",
  "  (Kolux, T-001: a note with - [ ] inside it is not a box)",
  "Acceptance:",
  "  - [x] One → two. (T-001)",
  "  - [x] Three → four, carried on",
  "        a second line. (T-001)",
  "Compat: —",
  "Source: D-01-001",
  "",
  "### AAA-002 · one box open",
  "Tier: P0 · Pushed: 1 · State at 0.15.0: live",
  "Acceptance:",
  "  - [x] One → two.",
  "  - [ ] Three → four.",
  "Compat: —",
  "",
  "### AAA-003 · P1 fully ticked does not count",
  "Tier: P1 · Pushed: 1 · State at 0.15.0: live",
  "Acceptance:",
  "  - [x] One → two.",
  "",
  "### AAA-004 · P0 with no boxes never passes",
  "Tier: P0 · Pushed: 1 · State at 0.15.0: live",
  "Acceptance:",
  "Compat: —",
  "",
  "### AAA-005 · P0, every box open",
  "Tier: P0 · Pushed: 1 · State at 0.15.0: live",
  "Acceptance:",
  "  - [ ] One → two.",
  "  - [ ] Three → four.",
  "Compat: —",
  "- [x] a stray box after the card's fields is not one of its acceptance boxes",
].join("\r\n");

describe("P0 cards passing (T-540)", () => {
  const cards = parseCards(SPEC);
  it("reads tier and acceptance boxes per card, continuation lines and notes excluded", () => {
    expect(cards.get("AAA-001")).toEqual({ tier: "P0", boxes: [true, true] });
    expect(cards.get("AAA-002")).toEqual({ tier: "P0", boxes: [true, false] });
    expect(cards.get("AAA-004").boxes).toEqual([]);
    expect(cards.get("AAA-005").boxes).toEqual([false, false]);
  });
  it("counts a P0 card only when every box is ticked; P1 and box-less cards do not count", () => {
    expect(p0Passing(cards)).toEqual({ passing: ["AAA-001"], total: 4 });
  });
  it("lets a Txais-confirmed DECISIONS line strike one box or a whole card, and a pending one strike nothing", () => {
    const decisions = [
      "| DT-X1 | strikes AAA-002 box 2 | done | why | confirmed by Txais 2026-10-13 |",
      "| DT-X2 | strikes AAA-005 | default | why | confirm |",
    ].join("\n");
    const s = parseStrikes(decisions);
    expect(s.get("AAA-002")).toEqual(new Set([2]));
    expect(s.has("AAA-005")).toBe(false);
    expect(p0Passing(cards, s).passing).toEqual(["AAA-001", "AAA-002"]);
    const whole = parseStrikes("| DT-X3 | strikes AAA-005; met by restore | x | y | confirmed by Txais 2026-10-14 |");
    expect(p0Passing(cards, whole).passing).toEqual(["AAA-001", "AAA-005"]);
    // striking box 1 of a two-box card with box 2 open is not enough
    const one = parseStrikes("strikes AAA-005 box 1 · confirmed by Txais 2026-10-14");
    expect(p0Passing(cards, one).passing).toEqual(["AAA-001"]);
  });
});

describe("cutline and merge gate (T-540)", () => {
  const plan = [
    "- [x] T-152 · done",
    "- [ ] T-167 · open",
    "- [x] T-025-d · done",
    "- [ ] T-003b-fix-a · open",
  ].join("\n");
  const tasks = planTasks(plan);
  it("reads ticked and open task ids, suffixes included", () => {
    expect([...tasks]).toEqual([["T-152", true], ["T-167", false], ["T-025-d", true], ["T-003b-fix-a", false]]);
  });
  it("reads the one Cutline line and counts ids not ticked, missing ones included", () => {
    const cut = parseCutline("text\nCutline: T-152, T-167, T-025-d, T-166-b  (the switch path; T-025-e left it)\nmore");
    expect(cut).toEqual(["T-152", "T-167", "T-025-d", "T-166-b"]);
    expect(cutlineLeft(cut, tasks)).toEqual({ left: ["T-167", "T-166-b"], missing: ["T-166-b"] });
    expect(parseCutline("no line here")).toBeNull();
    expect(() => parseCutline("Cutline: T-001\nCutline: T-002")).toThrow(/more than one/);
  });
  it("lists ids ticked on a lane but not ticked on HEAD, once each, with their lanes", () => {
    const lanes = new Map([
      ["core", planTasks("- [x] T-152 · x\n- [x] T-167 · x\n- [x] T-900 · lane-only line")],
      ["hooks", planTasks("- [x] T-167 · x\n- [ ] T-025-d · x")],
    ]);
    const waiting = mergeGate(tasks, lanes);
    expect([...waiting]).toEqual([["T-167", ["core", "hooks"]], ["T-900", ["core"]]]);
    expect(mergeGate(tasks, new Map()).size).toBe(0);
  });
});

describe("STATE.md head (T-540 --write-state)", () => {
  it("rewrites only the Done line, keeping CRLF line ends", () => {
    const state = "# STATE\r\nStatus: RUNNING\r\nDone: 1 / 2 tasks  ·  P0 cards passing: 0/228 cards\r\n\r\nWhat works today\r\n";
    const counts = { done: 212, tasks: 480, p0: 6, p0Total: 228, cutLeft: 8, cutTotal: 10, waiting: 91 };
    const out = rewriteStateHead(state, counts);
    expect(out.split("\r\n")).toEqual(["# STATE", "Status: RUNNING", doneLine(counts), "", "What works today", ""]);
    expect(doneLine(counts)).toMatch(/^Done: 212 \/ 480 tasks {2}· {2}P0 cards passing: 6 \/ 228 cards {2}· {2}cutline 8 \/ 10 left {2}· {2}merge gate 91 waiting/);
    expect(() => rewriteStateHead("# STATE\n", counts)).toThrow(/Done:/);
  });
});

describe("the real repository (T-540)", () => {
  const r = headCounts(undefined, new Map());
  it("still finds all 228 P0 cards and every box in the spec", () => {
    expect(r.counts.p0Total).toBe(228);
    let boxes = 0;
    for (const c of r.cards.values()) boxes += c.boxes.length;
    expect(boxes).toBeGreaterThanOrEqual(2737);
  });
  it("counts the P0 cards whose boxes are all ticked today (the six the council found, at least)", () => {
    for (const id of ["USAGE-002", "USAGE-003", "USAGE-005", "USAGE-006", "VIEW-008", "STAT-040"]) {
      expect(r.passing).toContain(id);
    }
  });
  it("reads the PRIORITIES.md cutline and keeps the plan covering every card once", () => {
    expect(r.cutline.length).toBeGreaterThan(0);
    expect(r.cutline).toContain("T-184");
    expect(coverageErrors(r.cards, r.decisions, r.plan).errors).toEqual([]);
  });
});
