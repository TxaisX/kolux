// TERM-017 acceptance: after random splits AND moves every pane still has its own session, and an output event is drawn by the
// pane it belongs to and by no other. The splits and moves are the real layout functions (the ones App.tsx applies); a session
// is bound to a pane by its key (App `ptys`, never touched by a layout change), and the routing test is codec.forPane, the
// function TerminalPane's "terminal-output" listener asks.
import { expect, test } from "vitest";
import { forPane } from "../codec";
import { cellsOf, columnsFor, groupOf, insertAfter, insertBefore, splitIndex } from "../grid";
import { dropCell, type Zone } from "../rearrange";

// One session per cell (owner decision 2026-11-12): the moves are a pane dragged onto another cell (every zone: the
// centre swaps, a band moves it to that side) and a pane opened beside the focused one (insertAfter).
type P = { key: number; cwd: string };
const ZONES: Zone[] = ["centre", "left", "right", "top", "bottom"];

function run(seed0: number) {
  let seed = seed0;
  const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
  let panes: P[] = [{ key: 1, cwd: "C:/w" }, { key: 2, cwd: "C:/w" }];
  const session = new Map<number, number>([[1, 101], [2, 102]]); // pane key -> session id, held outside the layout
  let next = 3;
  const moves: string[] = [];
  for (let i = 0; i < 10; i++) {
    const before = panes.map((p) => ({ ...p }));
    const kind = rnd(4);
    if (kind === 0 || panes.length < 3) {
      const src = panes[rnd(panes.length)];
      const shown = cellsOf(panes);
      const at = splitIndex(shown.map((c) => c.group), groupOf(src), rnd(2) ? "right" : "down", columnsFor(shown.length + 1));
      const k = next++;
      panes = insertBefore(panes, shown[at]?.panes[0], { key: k, cwd: "C:/w" });
      session.set(k, 100 + k);
      moves.push("split");
    } else if (kind === 1) {
      const k = next++;
      panes = insertAfter(panes, panes[rnd(panes.length)].key, { key: k, cwd: "C:/w" });
      session.set(k, 100 + k);
      moves.push("beside");
    } else {
      const r = dropCell(panes, groupOf(panes[rnd(panes.length)]), { group: groupOf(panes[rnd(panes.length)]), zone: ZONES[rnd(5)] });
      if (r) panes = r;
      moves.push("dropCell");
    }
    // nothing was lost, duplicated or changed: every earlier pane is still there once, with its folder and its session
    for (const old of before) {
      const now = panes.filter((p) => p.key === old.key);
      expect(now, `pane ${old.key} after ${moves[i]} #${i}`).toHaveLength(1);
      expect(now[0].cwd).toBe(old.cwd);
    }
    expect(new Set(panes.map((p) => p.key)).size).toBe(panes.length);
    expect(cellsOf(panes).flatMap((c) => c.panes.map((p) => p.key)).sort()).toEqual(panes.map((p) => p.key).sort());
    expect(cellsOf(panes).every((c) => c.panes.length === 1)).toBe(true); // one session per cell, after any move
    // the session map is separate state a layout change never writes to
    for (const p of panes) expect(session.get(p.key)).toBe(100 + p.key);
  }
  return { panes, session, moves };
}

test("box 1: after 10 random splits and moves (20 runs) each pane still has its own session and none was lost or doubled", () => {
  const used = new Set<string>();
  for (let s = 1; s <= 20; s++) {
    const { panes, moves } = run(s * 7919);
    moves.forEach((m) => used.add(m));
    expect(panes.length).toBeGreaterThanOrEqual(2);
  }
  // the runs really did moves, not only splits
  expect([...used].sort()).toEqual(["beside", "dropCell", "split"].sort());
});

test("box 2: after splits and moves, an output event is taken by the pane that owns that session and by no other", () => {
  for (let s = 1; s <= 20; s++) {
    const { panes, session } = run(s * 104729);
    for (const owner of panes) {
      const event = { id: session.get(owner.key) as number, pane: owner.key };
      // each pane holds its own session id once attached; before attaching it matches by the pane key it was started with
      const takers = panes.filter((p) => forPane(event, session.get(p.key) ?? null, p.key));
      expect(takers.map((p) => p.key)).toEqual([owner.key]);
      const unattached = panes.filter((p) => forPane(event, null, p.key));
      expect(unattached.map((p) => p.key)).toEqual([owner.key]);
    }
  }
});
