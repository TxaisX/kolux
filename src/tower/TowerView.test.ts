import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import TowerView from "./TowerView";
import { emptyWords, refreshLabel, revealRow, towerRows, type Seat } from "./tower";

const seat = (key: number): Seat => ({ key, agent: "claude", title: `pane ${key}`, branch: null, cwd: null, account: null, chip: null, meter: null, since: 0 });
const view = (detached?: boolean, ownWindow?: boolean) => renderToString(createElement(TowerView, { rows: towerRows([seat(1), seat(2)]), usage: [], now: 0, onOpen: () => {}, detached, ownWindow }));

test("T-546-c (council AFTER 2): the listbox is the list of rows, not the whole tower; each lane is a group", () => {
  const html = view();
  expect(html).toMatch(/<div class="list"[^>]*role="listbox"/);
  expect(html).not.toMatch(/<div class="tower"[^>]*role="listbox"/);
  expect(html.match(/role="listbox"/g)?.length).toBe(1);
  expect(html).toMatch(/<section role="group" aria-label="[^"]+"/);
  // the summary and usage cards sit outside the listbox
  expect(html.indexOf("Tower summary")).toBeLessThan(html.indexOf('role="listbox"'));
});

test("T-546-c (look FIX-3 patch): the Tower's own window is wired, so the main window's Tower offers it by default; passing ownWindow false hides it", () => {
  expect(view()).toContain("Own window");
  expect(view(false, false)).not.toContain("Own window");
  expect(view()).toContain("Refresh");
});

test("T-546-c: once wired, the main window's Tower offers its own window; the Tower window itself does not", () => {
  expect(view(false, true)).toContain("Own window");
  const detached = view(true, true);
  expect(detached).not.toContain("Own window");
  expect(detached).toContain('class="tower detached"');
  expect(detached).toContain("Refresh");
});

test("T-548: a usage card says whose figures it shows and how many panes run on other accounts", () => {
  const card = { agent: "codex", figures: { fiveHour: 5, weekly: null }, panes: 3, accounts: [{ account: "a", panes: 1 }, { account: "b", panes: 2 }], forAccount: "a", elsewhere: 2 };
  const html = renderToString(createElement(TowerView, { rows: [], usage: [card], now: 0, onOpen: () => {} }));
  expect(html).toContain("Figures for a");
  expect(html).toContain("2 panes on other accounts: not read yet");
  const none = renderToString(createElement(TowerView, { rows: [], usage: [{ ...card, figures: null, elsewhere: 3, panes: 3 }], now: 0, onOpen: () => {} }));
  expect(none).toContain("3 panes on other accounts: not read yet");
  // without the active accounts (the old call) the card says nothing about whose figures they are
  const old = renderToString(createElement(TowerView, { rows: [], usage: [{ agent: "codex", figures: null, panes: 1, accounts: [{ account: null, panes: 1 }] }], now: 0, onOpen: () => {} }));
  expect(old).not.toContain("Figures for");
  expect(old).not.toContain("other accounts");
});

test("the own window says Loading… before its first snapshot, not 'Nothing is running'", () => {
  const html = (loading: boolean) => renderToString(createElement(TowerView, { rows: [], usage: [], now: 0, onOpen: () => {}, loading }));
  expect(html(true)).toContain("Loading…");
  expect(html(true)).not.toContain("Nothing is running");
  expect(html(false)).toContain("Nothing is running");
  expect(emptyWords(true)).toBe("Loading…");
});

test("Refresh shows it is working", () => {
  expect(refreshLabel(true)).toBe("Refreshing…");
  expect(refreshLabel(false)).toBe("Refresh");
  expect(view()).toContain(">Refresh<");
});

test("the selected row is scrolled into view at the nearest edge", () => {
  const calls: unknown[] = [];
  const list = { querySelector: (sel: string) => (sel === "#tower-3" ? { scrollIntoView: (o: unknown) => void calls.push(o) } : null) };
  expect(revealRow(list, 3)).toBe(true);
  expect(calls).toEqual([{ block: "nearest" }]);
  expect(revealRow(list, 9)).toBe(false);
  expect(revealRow(list, null)).toBe(false);
  expect(revealRow(null, 3)).toBe(false);
});
