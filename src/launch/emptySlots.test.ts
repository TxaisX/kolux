// T-745 (DT-C181, live-wave3-a F15): layout "6" drew six cramped New-session sheets; now one cell shows the sheet
// and the others are empty slots until clicked. Each test uses its own pane keys: the remembered chooser is module state.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import ChooserPane from "./ChooserPane";
import { gridSheet } from "./emptySlots";
import { WindowStoreProvider } from "../shell/window/store";
import type { WindowBag } from "../shell/windowBag";

type P = { key: number; cwd: string | null; seats?: unknown };
const chooser = (key: number, cwd = "C:/p"): P => ({ key, cwd, seats: [{}] });
const shell = (key: number, cwd = "C:/p"): P => ({ key, cwd });
const grid = (cells: P[][], focused: number, over: Partial<{ board: boolean; zoomed: number | null }> = {}) => ({
  terminals: true, board: false, agentsScreen: false, zoomed: null, activeDir: "C:/p", focused,
  cells: cells.map((panes) => ({ panes })), activeOf: (c: { panes: P[] }) => c.panes[c.panes.length - 1].key, ...over,
});

test("one chooser, or none, keeps its full sheet: no slots", () => {
  expect(gridSheet(grid([], 1))).toBeNull();
  expect(gridSheet(grid([[shell(1)], [chooser(2)]], 1))).toBeNull();
});

test("only front tabs of this workspace's grid count; Board and a zoomed cell have no slots", () => {
  expect(gridSheet(grid([[chooser(3)], [chooser(4, "C:/other")]], 0)), "another workspace's chooser").toBeNull();
  expect(gridSheet(grid([[chooser(3)], [chooser(4), shell(5)]], 0)), "a chooser behind a terminal tab").toBeNull();
  const two = [[chooser(3)], [chooser(4)]];
  expect(gridSheet(grid(two, 0))).toBe(3);
  expect(gridSheet(grid(two, 0, { board: true }))).toBeNull();
  expect(gridSheet(grid(two, 0, { zoomed: 0 }))).toBeNull();
});

test("the focused chooser has the sheet, and keeps it when a terminal takes the focus", () => {
  const six = [[shell(10)], ...[11, 12, 13, 14, 15, 16].map((k) => [chooser(k)])];
  expect(gridSheet(grid(six, 10)), "nothing focused yet: the first").toBe(11);
  expect(gridSheet(grid(six, 14))).toBe(14);
  expect(gridSheet(grid(six, 10)), "copying from the terminal does not move the sheet").toBe(14);
  expect(gridSheet(grid(six.filter((c) => c[0].key !== 14), 10)), "closed: back to the first").toBe(11);
});

test("in the window, the other chooser draws an empty slot with no sheet; the full-page sheet never does", () => {
  const bag = grid([[chooser(21)], [chooser(22)]], 21) as unknown as WindowBag;
  const draw = (number: number, sheet: { project: string; path: string } | null = null) =>
    renderToString(
      createElement(WindowStoreProvider, {
        store: bag,
        children: createElement(ChooserPane, { number, agents: [], seats: [{ agent: null, model: null }], onSeats: () => {}, onLineup: () => {}, shape: "custom", task: "", onTask: () => {}, onStart: () => {}, copies: "separate", inGit: true, onCopies: () => {}, closable: true, onClose: () => {}, saved: [], onSaved: () => {}, onPickSaved: () => {}, sheet }),
      }),
    );
  expect(draw(21), "the focused chooser").toContain("Folders");
  const slot = draw(22);
  expect(slot).toContain("Choose what to run in session 22");
  expect(slot).toContain("Close session 22");
  expect(slot, "no cramped sheet in the slot").not.toContain("Folders");
  expect(draw(22, { project: "app", path: "C:/p" }), "the New session page").toContain("Folders");
});
