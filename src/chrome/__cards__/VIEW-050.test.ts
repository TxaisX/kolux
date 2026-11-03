// VIEW-050 acceptance, box 2: the real Grip drag, clamped by the real clampLeft, saved and read back by the real readLeft.
// MIRROR src/App.tsx:2767-2770 (onWidth: setDragLeft(done ? null : clampLeft(w)); saveSetting(LEFT_KEY, clampLeft(w))) and :518 (leftWidth = dragLeft ?? readLeft(settings)).
import { expect, test, vi } from "vitest";

const holder: { current: unknown } = { current: null };
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useRef: () => holder }));

import type { ReactElement } from "react";
import { Grip, LEFT_KEY, LEFT_MAX, LEFT_MIN, clampLeft, readLeft } from "../RightSidebar";

test("box 2: dragging the left edge past the maximum stops the width at the limit, shown while dragging and saved", () => {
  let dragLeft: number | null = null;
  const settings: Record<string, unknown> = { [LEFT_KEY]: 300 };
  const el = () =>
    Grip({ side: "left", width: dragLeft ?? readLeft(settings), label: "Resize the sidebar", className: "lside-grip", onWidth: (w, done) => {
      dragLeft = done ? null : clampLeft(w);
      if (done) settings[LEFT_KEY] = clampLeft(w);
    } }) as ReactElement<Record<string, (e: unknown) => void>>;
  // T-703: the drag starts from the sidebar as drawn (its wrapper, 8 px gutter included); in a wide window that is the saved width.
  const capture = { setPointerCapture: () => {}, previousElementSibling: { get offsetWidth() { return (dragLeft ?? readLeft(settings)) + 8; } } };
  el().props.onPointerDown({ clientX: 300, pointerId: 1, currentTarget: capture });
  el().props.onPointerMove({ clientX: 300 + 100 });
  expect(dragLeft).toBe(400); // inside the range it follows the pointer
  el().props.onPointerMove({ clientX: 300 + 900 }); // 900 px past: raw width 1200
  expect(dragLeft).toBe(LEFT_MAX);
  el().props.onPointerUp({ clientX: 300 + 900 });
  expect(dragLeft).toBeNull();
  expect(settings[LEFT_KEY]).toBe(LEFT_MAX);
  expect(readLeft(settings)).toBe(LEFT_MAX);
  expect(LEFT_MAX).toBe(480);
  // And past the minimum on the way back.
  el().props.onPointerDown({ clientX: 500, pointerId: 1, currentTarget: capture });
  el().props.onPointerMove({ clientX: -2000 });
  expect(dragLeft).toBe(LEFT_MIN);
  el().props.onPointerUp({ clientX: -2000 });
  expect(readLeft(settings)).toBe(LEFT_MIN);
});
