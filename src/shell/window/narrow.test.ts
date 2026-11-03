// T-699 (DT-C135): under 900 px the side panels take turns, so the workspace (and the New session sheet in it)
// keeps its room. The stylesheet rule does the hiding; narrow.ts keeps the left toggle in step with it.
import { afterEach, expect, test } from "vitest";
import { LEFT_DEFAULT, clampWidth, readRight } from "../../chrome/RightSidebar";
import { NARROW_PX, isNarrow, leftShown, nextLeft } from "./narrow";

// Vitest returns "" for a .css import, so the stylesheet is read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** A model of the layout (the real-layout pin is the headless Chromium run in evidence/T-699.txt).
 *  The workspace's width as the body lays it out: the left sidebar takes its width plus an 8 px gutter, the right
 *  sidebar its clamped width (Right.tsx clamps it against the left sidebar's state, shown or not). */
const workspace = (w: number, leftOpen: boolean, rightOpen: boolean, rule = true) => {
  const left = rule ? leftShown(leftOpen, w < NARROW_PX, rightOpen) : leftOpen;
  const right = rightOpen ? clampWidth(readRight({}).width, w, leftOpen ? LEFT_DEFAULT + 8 : 0) : 0;
  return w - (left ? LEFT_DEFAULT + 8 : 0) - right;
};

test("T-699: under 900 px the stylesheet hides the left sidebar and its grip while the right sidebar shows", () => {
  const at = css.indexOf(`@media (max-width: ${NARROW_PX - 1}px)`);
  expect(at).toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf("\n", at));
  expect(block).toContain(".body:has(> .rside:not([hidden])) > :is(.sidebar-wrap, .lside-grip) { display: none; }");
});

test("T-699: at 640 and 800 px the workspace keeps at least 340 px whichever panels are open; at 640 it used to get about 100", () => {
  for (const w of [640, 800]) {
    for (const [l, r] of [[true, true], [true, false], [false, true], [false, false]] as const) {
      expect(workspace(w, l, r), `${w} px, left ${l}, right ${r}`).toBeGreaterThanOrEqual(340);
    }
  }
  expect(workspace(640, true, true, false)).toBeLessThan(110); // the F17 shot: both panels, the sheet crushed
  expect(workspace(NARROW_PX, true, true)).toBeGreaterThanOrEqual(340); // at the app's 900 px minimum both still fit
});

test("T-699: every left-sidebar opener (toggle, Ctrl+B, menu, palette, create rows) shows what is in view and, in a narrow window, closes the right one", () => {
  expect(leftShown(true, true, true)).toBe(false); // stepped aside: the toggle reads "Show sidebar"
  const run = (open: boolean, v: boolean | ((o: boolean) => boolean), narrow: boolean, shown: boolean, rightOpen = shown) => {
    let closed = false;
    const left = nextLeft(open, v, narrow, { shown, open: rightOpen, close: () => (closed = true) });
    return { left, closed };
  };
  // From another screen the right sidebar is not in view but still open; the openers switch to Terminals, where it would show.
  expect(run(false, true, true, false, true)).toEqual({ left: true, closed: true });
  const toggle = (o: boolean) => !o;
  expect(run(true, toggle, true, true)).toEqual({ left: true, closed: true }); // stepped aside: the toggle brings it back
  expect(run(false, toggle, true, true)).toEqual({ left: true, closed: true });
  expect(run(true, toggle, true, false)).toEqual({ left: false, closed: false });
  expect(run(true, true, true, true)).toEqual({ left: true, closed: true }); // setSidebarOpen(true): the create and rename rows come into view
  expect(run(false, false, true, true)).toEqual({ left: false, closed: false });
  expect(run(false, toggle, false, true)).toEqual({ left: true, closed: false }); // wide: both fit, nothing closes
  expect(run(true, toggle, false, true)).toEqual({ left: false, closed: false });
  expect(run(true, true, false, true)).toEqual({ left: true, closed: false });
});

test("T-699: the selector's class names are the ones the body's children render", () => {
  const src = (p: string) => nodeFs.readFileSync(new URL(p, import.meta.url), "utf8");
  expect(src("../../projects/ProjectsPanel.tsx")).toContain('<div className="sidebar-wrap">');
  expect(src("./Sidebar.tsx")).toContain('className="lside-grip"');
  expect(src("../../chrome/RightSidebar.tsx")).toMatch(/<aside className="rside"[^>]*hidden=\{hidden\}/);
  // The `>` combinators need them as direct children of .body.
  expect(src("../WindowView.tsx")).toMatch(/<div className="body"[^>]*>\s*<Dialogs \/>\s*<Sidebar \/>\s*<Content \/>\s*<Right \/>\s*<\/div>/);
});

test("T-699: every left-sidebar setter goes through nextLeft, with the right sidebar's state filled in by App", () => {
  const src = (p: string) => nodeFs.readFileSync(new URL(p, import.meta.url), "utf8");
  expect(src("../windowStore.ts")).toMatch(/const setSidebarOpen = useCallback\([^\n]*nextLeft\(/);
  expect(src("../windowStore.ts")).not.toMatch(/\[sidebarOpen, setSidebarOpen\] = useState/);
  expect(src("../../App.tsx")).toMatch(/store\.rightAside\.current = \{ shown: terminals && plumb\.right\.open && !screenState\.fullPage, open: plumb\.right\.open,/);
});

const real = (globalThis as { matchMedia?: unknown }).matchMedia;
afterEach(() => void ((globalThis as { matchMedia?: unknown }).matchMedia = real));
test("T-699: isNarrow asks for the same 899 px query as the stylesheet", () => {
  const asked: string[] = [];
  (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => (asked.push(q), { matches: true });
  expect(isNarrow()).toBe(true);
  expect(asked).toEqual(["(max-width: 899px)"]);
  (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
  expect(isNarrow()).toBe(false);
});
