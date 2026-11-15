// Job 13 F7 and F9 (PLAUSIBLE when found): what the Start form ticks and how many seats it fills when it opens.
import { expect, test } from "vitest";
import { prefill } from "./startForm";
import { lineupOf, TERMINAL } from "./seats";
import paneActionsSrc from "../terminal/paneActions.ts?raw";

const projects = [{ id: "kolux" }, { id: "brain" }];
const last = { folders: ["brain"], count: 4 };

test("F7: New session from a grid with no project in front ticks no folder, not last time's", () => {
  // openStart({ here: true }) with no project in front says "none" with an empty list
  expect(paneActionsSrc).toContain("folders: o.here ? (pid ? [pid] : []) : null");
  expect(prefill({ projects, folders: [], last, lineup: null, installed: [] }).folders).toEqual([]);
  // the ask at open (no folders given) still opens on the last Start's folders
  expect(prefill({ projects, folders: null, last, lineup: null, installed: [] }).folders).toEqual(["brain"]);
  expect(prefill({ projects, folders: ["kolux"], last, lineup: null, installed: [] }).folders).toEqual(["kolux"]);
});

test("F9: a mixed lineup opened at a larger count leaves no blank seat; the count stops at the lineup's length", () => {
  const opus = { agent: "claude", model: "opus" };
  const term = { agent: TERMINAL, model: null };
  const lineup = lineupOf("custom", "shared", [opus, term] as never);
  const f = prefill({ projects, last, lineup, installed: ["claude"] });
  expect(f.seats.some((s) => s.agent === null)).toBe(false);
  expect(f.seats.length).toBe(2);
  // one pick for all still fills the larger count
  const same = prefill({ projects, last, lineup: lineupOf("custom", "shared", [opus, opus] as never), installed: ["claude"] });
  expect(same.seats.length).toBe(4);
  expect(same.seats.every((s) => s.agent === "claude")).toBe(true);
});
