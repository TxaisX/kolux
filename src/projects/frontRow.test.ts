// Audit F23, F24, F25 (and F30): three page readers looked for the project in front through the hidden worktree
// rows (`.sess.sel`, `button.branch.sel`), so they always found nothing. They now share frontRow.ts, which reads the
// visible project header. The repo has no DOM library, so a small matcher stands in for querySelector over the
// sidebar's markup, as in keys/workspaceRows.test.ts.
import { expect, test } from "vitest";
import { FRONT_PROJECT_ROW, frontProjectPath, frontProjectRow } from "./frontRow";
import panelSrc from "./ProjectsPanel.tsx?raw";
import stepSrc from "../onboarding/StepPanels.tsx?raw";
import toursSrc from "../onboarding/Tours.tsx?raw";

type Row = { name: string; tag: string; cls: string[]; attrs: Record<string, string>; inSidebar: boolean };

const matches = (r: Row, sel: string): boolean => {
  const m = /^\.sidebar ([a-z]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(sel.trim());
  if (!m) throw new Error(`matcher cannot read ${sel}`);
  const [, tag, cls, attrs] = m;
  if (!r.inSidebar || (tag && r.tag !== tag)) return false;
  if (cls.split(".").filter(Boolean).some((c) => !r.cls.includes(c))) return false;
  return [...attrs.matchAll(/\[([\w-]+)\]/g)].every(([, k]) => k in r.attrs);
};

// The page today: project B's grid is in front. Its hidden main row and a hidden worktree row carry .sel too,
// and the Agents rail (outside the sidebar list's project rows) has a selected .sess row.
const page: Row[] = [
  { name: "A", tag: "div", cls: ["proj", "folder"], attrs: { "data-path": "C:/a", role: "button" }, inSidebar: true },
  { name: "B", tag: "div", cls: ["proj", "folder", "sel"], attrs: { "data-path": "C:/b", role: "button" }, inSidebar: true },
  { name: "B main (hidden)", tag: "button", cls: ["branch", "sel"], attrs: {}, inSidebar: true },
  { name: "B wt (hidden)", tag: "div", cls: ["sess", "sel"], attrs: { role: "button", "data-path": "C:/ws/b-fix" }, inSidebar: true },
  { name: "rail", tag: "div", cls: ["sess", "sel"], attrs: { role: "button" }, inSidebar: false },
];
const doc = (rows: Row[]) => ({
  querySelector: (sel: string) => {
    const r = rows.find((x) => matches(x, sel));
    return r ? ({ name: r.name, dataset: { path: r.attrs["data-path"] } } as unknown as HTMLElement) : null;
  },
});

test("the project in front is the visible header marked selected, never a hidden row or the Agents rail", () => {
  expect((frontProjectRow(doc(page) as never) as unknown as { name: string }).name).toBe("B");
  expect(frontProjectPath(doc(page) as never)).toBe("C:/b");
});

test("with no project in front there is no row and no path", () => {
  const none = page.map((r) => ({ ...r, cls: r.cls.filter((c) => c !== "sel") }));
  expect(frontProjectRow(doc(none) as never)).toBeNull();
  expect(frontProjectPath(doc(none) as never)).toBeNull();
});

test("the selector names the project header, not a .sess row (F30)", () => {
  expect(FRONT_PROJECT_ROW).toBe(".sidebar .proj.folder.sel[data-path]");
  expect(FRONT_PROJECT_ROW).not.toContain(".sess");
});

test("F23: the reveal-selected effect scrolls the project header into view", () => {
  expect(panelSrc).toContain("const row = frontProjectRow();");
  expect(panelSrc).not.toContain(":is(button.branch, .sess[role=button]).sel");
});

test("F24: the Setup Guide step aims at the project on screen", () => {
  expect(stepSrc).toContain("const active = shown ?? frontProjectPath();"); // R27-03: the window's shown grid first, the header as fallback
  expect(stepSrc).not.toContain(".sess.sel");
});

test("F25: the parallel tour's 'terminals in front' check reads the project header", () => {
  expect(toursSrc).toContain("const workspaceTab = !!frontProjectRow();");
  expect(toursSrc).not.toContain(".sess.sel");
});
