// T-609 (brief "Path to an A", Phase 0): "Review changes" on a Board Done card and on an Inbox row opens
// the existing review of that pane's worktree: its All Changes tab (EDIT-029), no new screen.
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { ChipRow } from "./ChipRow";
import { canReview, reviewTab } from "./review";
import { chipOf, type Chip } from "./chip";
import { detailActions } from "../inbox/InboxView";
import { inboxItems, sourceOf, type Item } from "../inbox/inbox";

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

test("T-609: an Inbox row that is done offers Review changes beside Open in Code; a row that needs you or is running does not", () => {
  const src = (key: number, state: "done" | "permission" | "working") => sourceOf({ key, agent: "claude", branch: "feat", cwd: `G:/repo/w${key}` }, `Claude ${key}`, state, true, { at: now - 60_000, interrupted: false });
  const items = inboxItems([src(1, "done"), src(2, "permission"), src(3, "working")], now);
  const of = (key: number) => items.find((i) => i.key === key) as Item;
  const reviewed: number[] = [];
  const actions = (key: number) => buttons(detailActions({ item: of(key), onOpen: () => {}, onReview: () => reviewed.push(key) })).map((b) => b.text);
  expect(actions(1)).toEqual(["Open in Code", "Review changes"]);
  expect(actions(2)).toEqual(["Answer in Code"]);
  expect(actions(3)).toEqual(["Open in Code"]);
  expect(renderToString(detailActions({ item: of(1), onOpen: () => {}, onReview: () => {} }))).toContain(">Review changes<");
  buttons(detailActions({ item: of(1), onOpen: () => {}, onReview: () => reviewed.push(1) })).find((b) => b.text === "Review changes")!.click();
  expect(reviewed).toEqual([1]);
  // A row with no workspace folder has nothing to review.
  const loose = inboxItems([sourceOf({ key: 9, agent: "claude", branch: null, cwd: null }, "Claude 9", "done", true, { at: now - 60_000, interrupted: false })], now)[0];
  expect(buttons(detailActions({ item: loose, onOpen: () => {}, onReview: () => {} })).map((b) => b.text)).toEqual(["Open in Code"]);
});

test("T-609: the one rule: only finished work is offered for review", () => {
  expect(canReview("done")).toBe(true);
  for (const l of ["needs", "working", "stopped", "idle", "waiting"]) expect(canReview(l)).toBe(false);
});

test("T-609: Review changes opens that pane's worktree in All Changes, in the pane's own cell, never the workspace in front", () => {
  const panes = [
    { key: 1, cwd: "G:/repo", branch: "main", agent: "claude" },
    { key: 2, cwd: "G:/repo/.w/fix-login", branch: "fix-login", agent: "claude" },
    { key: 3, cwd: "G:/repo/.w/fix-login", branch: "fix-login", agent: "shell" },
    { key: 4, cwd: "G:/repo", branch: "main", agent: "shell", kind: "changes" },
  ];
  // Pane 2's worktree has no All Changes tab yet: one opens in the cell right after pane 2 (one session per cell), on its branch.
  expect(reviewTab(panes, 2)).toEqual({ open: { cwd: "G:/repo/.w/fix-login", branch: "fix-login", after: 2 } });
  // Pane 1's worktree already has its All Changes tab in this grid: it comes to the front instead of a second one.
  expect(reviewTab(panes, 1)).toEqual({ focus: 4 });
  // A pane with no folder, or one that is gone, has nothing to review.
  expect(reviewTab([{ key: 5, cwd: null, branch: null }], 5)).toBeNull();
  expect(reviewTab(panes, 99)).toBeNull();
  // An All Changes tab of another worktree shown in the same grid is not taken for this one.
  expect(reviewTab([{ key: 6, cwd: "G:/a", view: "G:/team", branch: null }, { key: 7, cwd: "G:/b", view: "G:/team", branch: null, kind: "changes" }], 6)).toEqual({ open: { cwd: "G:/a", view: "G:/team", branch: null, after: 6 } });
});

test("DT-C52 / T-609: an Inbox row Stopped because its program exited offers Review changes once its worktree holds changes", () => {
  const [row] = inboxItems([sourceOf({ key: 4, agent: "claude", branch: "feat", cwd: "G:/repo/w4" }, "Claude 4", undefined, false, { at: now - 60_000, interrupted: false })], now);
  expect(row.group).toBe("stopped");
  const actions = (changed: number | null) => buttons(detailActions({ item: row, onOpen: () => {}, onReview: () => {}, changed })).map((b) => b.text);
  expect(actions(3)).toEqual(["Open in Code", "Review changes"]);
  expect(actions(0), "a clean worktree has nothing to review").toEqual(["Open in Code"]);
  expect(actions(null), "not read yet").toEqual(["Open in Code"]);
  expect([canReview("stopped", 2), canReview("stopped"), canReview("done"), canReview("needs", 5)]).toEqual([true, false, true, false]);
});
