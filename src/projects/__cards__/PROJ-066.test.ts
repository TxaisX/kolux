// PROJ-066 box 2: deleting a workspace leaves none of its tabs anywhere (open panes of every kind,
// the saved layout a restart would read back).
import { expect, test } from "vitest";
import { activeAfterRemove, focusIn, panesIn, withoutDir } from "../../workspaces";
import { layoutOf, restoreLayout } from "../../terminal/layout";

const W = "C:\\ws\\app\\doomed";
const B = "C:\\ws\\app\\keeper";
const pane = (key: number, cwd: string | null, extra: Record<string, unknown> = {}) => ({ key, cwd, branch: null, agent: "shell" as const, program: null, args: [] as string[], ...extra });

test("deleting a workspace removes its terminals, agent, editor, diff and preview tabs from the panes, the layout and the saved copy", () => {
  const panes = [
    pane(1, null),
    pane(2, W),
    pane(3, W + "\\sub\\deeper"), // a terminal opened in a folder inside it
    { ...pane(4, W), agent: "claude" as const, agentId: "claude", program: "claude" },
    pane(5, W, { kind: "editor", path: W + "\\README.md" }),
    pane(6, W, { kind: "diff", path: "a.ts", staged: false }),
    pane(7, W, { kind: "preview" }),
    pane(8, B),
    pane(9, B, { kind: "editor", path: B + "\\x.ts" }),
  ];
  expect(panesIn(panes, W).map((p) => p.key)).toEqual([2, 4, 5, 6, 7]); // before: the workspace has tabs

  const left = withoutDir(panes, W);
  expect(left.map((p) => p.key)).toEqual([1, 8, 9]);
  expect(left.some((p) => p.cwd !== null && p.cwd.toLowerCase().startsWith(W.toLowerCase()))).toBe(false);
  expect(panesIn(left, W)).toEqual([]);

  // The layout written down for the next start holds none of them either.
  const saved = layoutOf(left, 8, B, {});
  expect(saved.panes.map((p) => p.key)).toEqual([1, 8, 9]);
  expect(JSON.stringify(saved)).not.toContain("doomed");
  const back = restoreLayout(JSON.parse(JSON.stringify(saved)))!;
  expect(back.panes.map((p) => p.key)).toEqual([1, 8, 9]);
  expect(JSON.stringify(back)).not.toContain("doomed");

  // The view leaves the deleted workspace for its sibling; the other workspace keeps its tabs.
  expect(activeAfterRemove(W, W, [W, B], [B])).toBe(B);
  expect(panesIn(left, B).map((p) => p.key)).toEqual([8, 9]);
});

// PROJ-066 box 1: switch from A to B and back; A's terminals and tabs are as they were.
test("switching A to B and back shows A's very same terminals and tabs, in the same order, and B's too", () => {
  const A = "C:\\ws\\app\\alpha";
  const B = "C:\\ws\\app\\beta";
  const panes = [
    pane(1, A),
    { ...pane(2, A), agent: "claude" as const, agentId: "claude", program: "claude" },
    pane(3, A, { kind: "editor", path: A + "\\main.rs" }),
    pane(4, B),
    pane(5, B, { kind: "preview" }),
  ];
  const before = panesIn(panes, A);
  expect(before.map((p) => p.key)).toEqual([1, 2, 3]);

  // Switching changes only which folder is in front: the focus moves into B ...
  expect(focusIn(panes, B, 2)).toBe(4);
  expect(panesIn(panes, B).map((p) => p.key)).toEqual([4, 5]);
  // ... and back to A: the same pane records (same objects, same order, same kinds), nothing re-made or dropped.
  const back = panesIn(panes, A);
  expect(back.length).toBe(before.length);
  back.forEach((p, i) => expect(p).toBe(before[i]));
  expect(back.map((p) => [p.key, (p as { kind?: string }).kind ?? "terminal", p.agent])).toEqual([[1, "terminal", "shell"], [2, "terminal", "claude"], [3, "editor", "shell"]]);
  expect(focusIn(panes, A, 2)).toBe(2); // a focused pane of A stays focused
  // Spelling the folder another way (slashes, case, trailing slash) still finds the same panes.
  expect(panesIn(panes, "c:/WS/app/alpha/").map((p) => p.key)).toEqual([1, 2, 3]);
});
