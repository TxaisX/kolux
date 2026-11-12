// VIEW-024 acceptance: the Board's cards are the real cellsOf (tab-group order) filtered by the real cardPanes.
// MIRROR src/App.tsx:2210 (cells = cellsOf(panes)), :2309 (lanes use cardPanes) and the cell -> pane render at :3020-3190, where
// editor / diff tabs (`kind`) render a preview, not a card.
import { expect, test } from "vitest";
import { cardPanes } from "../../agents/rail";
import { cellsOf } from "../grid";

type P = { key: number; cwd: string; kind?: string; group?: number };
const cardsInOrder = (panes: P[]) => cellsOf(panes).flatMap((c) => cardPanes(c.panes)).map((p) => p.key);

test("box 1: two tabs, one split into two panes, give three cards in tab order", () => {
  // Tab A holds pane 1. Tab B is split: panes 2 and 3 are two cells. Panes were opened 1, 2, 3.
  const panes: P[] = [{ key: 1, cwd: "C:/w/a" }, { key: 2, cwd: "C:/w/b" }, { key: 3, cwd: "C:/w/b" }];
  expect(cardsInOrder(panes)).toEqual([1, 2, 3]);
  expect(cardPanes(panes)).toHaveLength(3);
  // Tab order follows the cell's first pane, not the key: a pane 4 grouped as a tab of cell 1 sits with it.
  expect(cardsInOrder([{ key: 1, cwd: "C:/w/a" }, { key: 2, cwd: "C:/w/b" }, { key: 4, cwd: "C:/w/a", group: 1 }])).toEqual([1, 4, 2]);
});

test("box 2: an editor tab and a diff tab get no card", () => {
  const panes: P[] = [{ key: 1, cwd: "C:/w/a" }, { key: 2, cwd: "C:/w/a", kind: "editor" }, { key: 3, cwd: "C:/w/a", kind: "diff" }, { key: 4, cwd: "C:/w/b" }];
  expect(cardsInOrder(panes)).toEqual([1, 4]);
  expect(cardPanes(panes).map((p) => p.key)).toEqual([1, 4]);
});
