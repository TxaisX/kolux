// GIT-016 acceptance: the review prompt built from the statuses and branch summaries a REAL git repository produced.
// evidence/cards-GIT-states.json is written by src-tauri/tests/cards_11.rs (git016_boxes_*: 60 files, then a clean branch).
// The Source Control panel that called this reviewPrompt(base, summary.committed, summary.files, rowOrder(status)) was removed (audit F16); the card pins the model helper alone.
import { expect, test } from "vitest";
import fixture from "../../../evidence/cards-GIT-states.json";
import { reviewPrompt, rowOrder, type Status, type Summary } from "../model";

const w = (fixture as unknown as Record<string, Record<string, { status: Status; summary: Summary }>>).git016;
const prompt = (k: string) => reviewPrompt(w[k].summary.against, w[k].summary.committed, w[k].summary.files, rowOrder(w[k].status, undefined));

test("GIT-016 box 1: sixty changed files, committed or not: the prompt names the base, lists 50 and mentions 10 more", () => {
  for (const k of ["committed60", "uncommitted60"]) {
    const p = prompt(k)!;
    expect(p, k).toContain(w[k].summary.against);
    expect(p).toContain("It will merge into main");
    expect(p.match(/^- src\/f\d+\.ts$/gm)?.length, k).toBe(50);
    expect(p).toContain("- and 10 more");
  }
  expect(w.uncommitted60.status.untracked).toHaveLength(60);
  expect(w.committed60.summary.files).toBe(60);
});

test("GIT-016 box 2: a clean branch gets no prompt, so no agent is launched", () => {
  expect(w.clean.summary.files).toBe(0);
  expect(rowOrder(w.clean.status, undefined)).toEqual([]);
  expect(prompt("clean")).toBeNull();
});
