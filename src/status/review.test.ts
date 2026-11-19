// T-609 (brief "Path to an A", Phase 0): "Review changes" on a Done card opens
// the existing review of that pane's worktree: its All Changes tab (EDIT-029), no new screen.
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { ChipRow } from "./ChipRow";
import { canReview, reviewTab } from "./review";
import { chipOf, type Chip } from "./chip";

const now = 1_000_000;
const chip = (state: "done" | "working" | "permission" | "blocked"): Chip => chipOf({ agent: "claude", state, running: true, stale: false, since: now - 60_000, tool: "Bash", reply: "All tests pass" }, now)!;

/** The buttons of a rendered element tree, with their text and click handler. */
function buttons(el: ReactElement | null): Array<{ text: string; click: () => void }> {
  const out: Array<{ text: string; click: () => void }> = [];
  const text = (n: unknown): string => (typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(text).join("") : n && typeof n === "object" && "props" in n ? text((n as ReactElement<{ children?: unknown }>).props.children) : "");
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object" || !("props" in n)) return;
    const e = n as ReactElement<{ children?: unknown; onClick?: () => void }>;
    if (typeof e.type === "function") return walk((e.type as (p: unknown) => unknown)(e.props));
    if (e.type === "button") out.push({ text: text(e.props.children), click: () => e.props.onClick?.() });
    walk(e.props.children);
  };
  walk(el);
  return out;
}

test("T-609: a Done card offers Review changes; a working, waiting or stopped card does not", () => {
  const opened: string[] = [];
  const done = renderToString(createElement(ChipRow, { chip: chip("done"), onReview: () => opened.push("review") }));
  expect(done).toContain(">Review changes<");
  for (const s of ["working", "permission", "blocked"] as const) expect(renderToString(createElement(ChipRow, { chip: chip(s), onReview: () => {} })), s).not.toContain("Review changes");
  // The card keeps what it showed before the move out of the pane: the word, the line, Approve and Deny for a named permission.
  expect(done).toContain(">Done<");
  expect(done).toContain("All tests pass");
  const asks = renderToString(createElement(ChipRow, { chip: chip("permission"), onAnswer: () => {} }));
  expect(asks).toContain(">Approve<");
  expect(asks).toContain(">Deny<");
  // Pressing it runs the card's review.
  buttons(ChipRow({ chip: chip("done"), onReview: () => opened.push("review") })).find((b) => b.text === "Review changes")!.click();
  expect(opened).toEqual(["review"]);
});

test("T-609: the one rule: only finished work is offered for review", () => {
  expect(canReview("done")).toBe(true);
  for (const l of ["needs", "working", "stopped", "idle", "waiting"]) expect(canReview(l)).toBe(false);
});

test("T-609: Review changes opens that pane's worktree in All Changes, in the pane's own cell, never the workspace in front", () => {
  const panes = [
    { key: 1, cwd: "G:/repo", branch: "main", agent: "claude" },
    { key: 2, cwd: "G:/repo/.w/fix-login", branch: "fix-login", agent: "claude" },
    { key: 3, cwd: "G:/repo/.w/fix-login", branch: "fix-login", agent: "shell", group: 2 },
    { key: 4, cwd: "G:/repo", branch: "main", agent: "shell", kind: "changes", group: 1 },
  ];
  // Pane 2's worktree has no All Changes tab yet: one opens there, beside pane 2, on its branch.
  expect(reviewTab(panes, 2)).toEqual({ open: { cwd: "G:/repo/.w/fix-login", branch: "fix-login", group: 2 } });
  // Pane 1's cell already has its All Changes tab: it comes to the front instead of a second one.
  expect(reviewTab(panes, 1)).toEqual({ focus: 4 });
  // A pane with no folder, or one that is gone, has nothing to review.
  expect(reviewTab([{ key: 5, cwd: null, branch: null }], 5)).toBeNull();
  expect(reviewTab(panes, 99)).toBeNull();
  // An All Changes tab of another worktree in the same cell is not taken for this one.
  expect(reviewTab([{ key: 6, cwd: "G:/a", branch: null }, { key: 7, cwd: "G:/b", branch: null, kind: "changes", group: 6 }], 6)).toEqual({ open: { cwd: "G:/a", branch: null, group: 6 } });
});

test("DT-C52 / T-609: a stopped card offers Review changes once its worktree holds changes, and only then", () => {
  expect([canReview("stopped", 2), canReview("stopped"), canReview("stopped", 0), canReview("done"), canReview("needs", 5)]).toEqual([true, false, false, true, false]);
});
