// Audit F12: Ctrl+1..9 and Ctrl+Shift+Up/Down walk the sidebar rows the user can see. Since one grid per
// project the old main and worktree rows are still in the page, hidden, so the walk must skip them.
// The repo has no DOM library, so a small matcher stands in for querySelectorAll over the sidebar's markup.
import { expect, test } from "vitest";
import { navTarget } from "../projects/nav";
import { WORKSPACE_ROWS } from "./useWindowKeys";
import panelSrc from "../projects/ProjectsPanel.tsx?raw";

type Row = { name: string; tag: string; cls: string[]; attrs: Record<string, string>; hidden: boolean };

// Matches "tag.a.b[attr]" or "tag.a[attr=v]" compounds, ":is(x, y)" lists, and a leading ".sidebar " ancestor.
const compound = (r: Row, sel: string): boolean => {
  const m = /^([a-z]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(sel.trim());
  if (!m) throw new Error(`matcher cannot read ${sel}`);
  const [, tag, cls, attrs] = m;
  if (tag && r.tag !== tag) return false;
  if (cls.split(".").filter(Boolean).some((c) => !r.cls.includes(c))) return false;
  return [...attrs.matchAll(/\[([\w-]+)(?:=([^\]]+))?\]/g)].every(([, k, v]) => k in r.attrs && (v === undefined || r.attrs[k] === v));
};
const matches = (r: Row, sel: string): boolean => {
  const rest = sel.replace(/^\.sidebar\s+/, "");
  const is = /^:is\((.*)\)$/.exec(rest);
  return is ? is[1].split(",").some((s) => compound(r, s)) : compound(r, rest);
};

// Project A has two worktrees, project B has none, as ProjectsPanel draws them today.
const page = (selA: boolean): Row[] => [
  { name: "A", tag: "div", cls: ["proj", "folder", ...(selA ? ["sel"] : [])], attrs: { "data-path": "C:/a", role: "button" }, hidden: false },
  { name: "A main", tag: "button", cls: ["branch", ...(selA ? ["sel"] : [])], attrs: {}, hidden: true },
  { name: "A wt1", tag: "div", cls: ["sess"], attrs: { role: "button" }, hidden: true },
  { name: "A wt2", tag: "div", cls: ["sess"], attrs: { role: "button" }, hidden: true },
  { name: "B", tag: "div", cls: ["proj", "folder", ...(selA ? [] : ["sel"])], attrs: { "data-path": "C:/b", role: "button" }, hidden: false },
  { name: "B main", tag: "button", cls: ["branch", ...(selA ? [] : ["sel"])], attrs: {}, hidden: true },
];

// What the key handler does: list the rows, find the selected one, pick the target.
const press = (rows: Row[], how: { index: number } | { step: 1 | -1 }) => {
  const list = rows.filter((r) => matches(r, WORKSPACE_ROWS));
  const at = list.findIndex((r) => r.cls.includes("sel"));
  const i = navTarget(list.length, at, how);
  return i === null ? null : list[i];
};

test("the walk lists only the visible project rows, in the order shown", () => {
  expect(page(true).filter((r) => matches(r, WORKSPACE_ROWS)).map((r) => [r.name, r.hidden])).toEqual([["A", false], ["B", false]]);
});

test("Ctrl+2 opens the second project, not the first project's worktree", () => {
  expect(press(page(true), { index: 2 })?.name).toBe("B");
  expect(press(page(true), { index: 1 })?.name).toBe("A");
  expect(press(page(true), { index: 3 })).toBeNull();
});

test("Ctrl+Shift+Down from the first project reaches the second, then wraps to the first", () => {
  const first = press(page(true), { step: 1 });
  expect(first?.name).toBe("B");
  expect(press(page(false), { step: 1 })?.name).toBe("A");
  expect(press(page(true), { step: -1 })?.name).toBe("B");
});

test("the selector still fits the project row ProjectsPanel draws", () => {
  expect(panelSrc).toContain('className={`proj${folder ? " folder" : ""}${folder && selected ? " sel" : ""}`}');
  expect(panelSrc).toContain("data-path={folder ? main.path : undefined}");
});
