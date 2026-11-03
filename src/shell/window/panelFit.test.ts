// T-703 (DT-C139): a side panel dragged wider than its default gives its width back before the workspace drops under
// the T-699 floor (340 px). styles.css does the clamping (it follows the window as it shrinks, with no re-render); the
// drag edge starts from the width as drawn. The real-layout pin is the headless Chromium run in evidence/T-703.txt.
import { expect, test, vi } from "vitest";

const holder: { current: unknown } = { current: null };
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useRef: () => holder }));

import type { ReactElement } from "react";
import { Grip, LEFT_MAX, LEFT_MIN, RIGHT_MIN, clampWidth } from "../../chrome/RightSidebar";
import { NARROW_PX } from "./narrow";

// Vitest returns "" for a .css import, so the stylesheet is read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

const FLOOR = 340;
const RULES = [
  ".body > .sidebar-wrap:not(.rail-wrap) > .sidebar { width: max(220px, min(var(--sidebar-w), 100vw - 348px)); }",
  ".body:has(> .rside:not([hidden])) > .sidebar-wrap:not(.rail-wrap) > .sidebar { width: max(220px, min(var(--sidebar-w), 100vw - 588px)); }",
  ".body > .rside { max-width: max(240px, 100vw - 340px); }",
  ".body:has(> .sidebar-wrap:not(.rail-wrap)) > .rside { max-width: max(240px, 100vw - 348px - min(var(--sidebar-w), 100vw - 588px)); }",
  ".app:has(> .body > .sidebar-wrap:not(.rail-wrap)) .titlebar .topbar-left { max-width: max(228px, 100vw - 340px); }",
  ".app:has(> .body > .sidebar-wrap:not(.rail-wrap)):has(> .body > .rside:not([hidden])) .titlebar .topbar-left { max-width: max(228px, 100vw - 580px); }",
];

/** The body as the stylesheet lays it out, rule for rule (RULES above and the T-699 step-aside).
 *  `left` is the saved left width or null when closed; `right` the width the app last drew for the right sidebar or
 *  null when hidden. Returns the drawn widths: the left sidebar with its 8 px gutter, the right sidebar, the workspace. */
const layout = (W: number, left: number | null, right: number | null) => {
  const stepAside = right !== null && W < NARROW_PX;
  const l = left === null || stepAside ? 0 : 8 + Math.max(LEFT_MIN, Math.min(left, W - (right === null ? 348 : 588)));
  const rMax = left === null ? Math.max(RIGHT_MIN, W - FLOOR) : Math.max(RIGHT_MIN, W - 348 - Math.min(left, W - 588));
  const r = right === null ? 0 : Math.min(right, rMax);
  return { l, r, work: W - l - r };
};

test("T-703: the stylesheet carries the clamp rules, after the T-699 step-aside", () => {
  const stepAside = css.indexOf(`@media (max-width: ${NARROW_PX - 1}px) { .body:has(> .rside:not([hidden]))`);
  expect(stepAside).toBeGreaterThan(-1);
  for (const rule of RULES) expect(css.indexOf(rule), rule).toBeGreaterThan(stepAside);
  // The Agents screen's rail is also a .sidebar-wrap beside .body; it keeps its own width (.rail), so no clamp names a bare one.
  expect(css.match(/^\.body[^{]*\.sidebar-wrap(?!:not\(\.rail-wrap\))[^{]*\{[^}]*--sidebar-w/gm)).toBeNull();
  // The constants: 348 = the floor + the left gutter; 588 = that + the right sidebar's minimum.
  expect([LEFT_MIN, RIGHT_MIN, LEFT_MAX]).toEqual([220, 240, 480]);
  expect(348).toBe(FLOOR + 8);
  expect(588).toBe(FLOOR + 8 + RIGHT_MIN);
});

test("T-703: at 640, 800 and 1400 px a widened panel (left 480, or the right drawn at 900) leaves the workspace 340 px or more", () => {
  for (const W of [640, 800, 900, 1000, 1400]) {
    for (const left of [null, 289, LEFT_MAX]) {
      for (const right of [null, RIGHT_MIN, 300, 900]) {
        const { l, work } = layout(W, left, right);
        expect(work, `${W} px, left ${left}, right ${right}`).toBeGreaterThanOrEqual(FLOOR);
        // Classic's title header cell (saved width + 8, capped by the last two rules) lines up with the card as drawn.
        if (l > 0 && left !== null) expect(Math.min(left + 8, Math.max(228, W - (right === null ? 340 : 580))), `header at ${W} px`).toBe(l);
      }
    }
  }
  // Before T-703: the left sidebar at 480 kept its width; at 640 alone the workspace got 152 px, at 1000 beside the right one 272.
  expect(640 - (LEFT_MAX + 8)).toBeLessThan(FLOOR);
  expect(1000 - (LEFT_MAX + 8) - RIGHT_MIN).toBeLessThan(FLOOR);
});

test("T-703: the dragged panel gives back its width first; the step-aside starts only under 900 px; a wide window keeps the saved width", () => {
  expect(layout(1400, LEFT_MAX, RIGHT_MIN)).toEqual({ l: 488, r: 240, work: 672 }); // room: nothing changes
  expect(layout(1000, LEFT_MAX, RIGHT_MIN)).toEqual({ l: 420, r: 240, work: 340 }); // the left gives back 60 px
  expect(layout(900, LEFT_MAX, RIGHT_MIN)).toEqual({ l: 320, r: 240, work: 340 }); // still both, the left narrower
  expect(layout(899, LEFT_MAX, RIGHT_MIN).l).toBe(0); // then the T-699 step-aside
  expect(layout(1400, 289, 900)).toEqual({ l: 297, r: 763, work: FLOOR }); // a right sidebar drawn before the shrink gives back
  // What the app draws for the right sidebar (Right.tsx clampWidth) is never cut by the stylesheet: the rules only catch a stale width.
  for (const W of [900, 1000, 1400, 2000]) {
    for (const left of [null, 289, LEFT_MAX]) {
      const drawn = clampWidth(2000, W, left === null ? 0 : left + 8);
      expect(layout(W, left, drawn).r, `${W} px, left ${left}`).toBe(drawn);
    }
  }
});

test("T-703: a drag starts from the width as drawn, so a narrowed panel answers the pointer at once", () => {
  const got: number[] = [];
  const grip = (side: "left" | "right") => Grip({ side, width: 480, min: 220, max: 480, label: "", className: "", onWidth: (w) => got.push(w) }) as ReactElement<Record<string, (e: unknown) => void>>;
  const target = { setPointerCapture: () => {}, previousElementSibling: { offsetWidth: 420 + 8 }, parentElement: { offsetWidth: 300 } };
  grip("left").props.onPointerDown({ clientX: 500, pointerId: 1, currentTarget: target });
  grip("left").props.onPointerMove({ clientX: 490 });
  grip("right").props.onPointerDown({ clientX: 500, pointerId: 1, currentTarget: target });
  grip("right").props.onPointerMove({ clientX: 510 });
  expect(got).toEqual([410, 290]); // not 470 and 470 from the saved 480
});
