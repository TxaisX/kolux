// T-699 (DT-C135): under 900 px the side panels take turns, so the workspace (and the New session sheet in it)
// keeps its room. The stylesheet rule does the hiding; narrow.ts keeps the left toggle in step with it.
import { afterEach, expect, test } from "vitest";
import { LEFT_DEFAULT, clampWidth, readRight } from "../../chrome/RightSidebar";
import { NARROW_PX, isNarrow, leftShown, toggleLeft } from "./narrow";

// Vitest returns "" for a .css import, so the stylesheet is read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** The workspace's width as the body lays it out: the left sidebar takes its width plus an 8 px gutter, the right
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

test("T-699: the left toggle shows what is in view, and in a narrow window it brings the left sidebar back by closing the right one", () => {
  expect(leftShown(true, true, true)).toBe(false); // stepped aside: the toggle reads "Show sidebar"
  expect(toggleLeft(true, true, true)).toEqual({ left: true, closeRight: true });
  expect(toggleLeft(false, true, true)).toEqual({ left: true, closeRight: true });
  expect(toggleLeft(true, true, false)).toEqual({ left: false, closeRight: false });
  expect(toggleLeft(false, false, true)).toEqual({ left: true, closeRight: false }); // wide: both fit, nothing closes
  expect(toggleLeft(true, false, true)).toEqual({ left: false, closeRight: false });
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
