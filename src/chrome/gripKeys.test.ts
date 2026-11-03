// T-711 (DT-C147): both sidebar grips are focusable separators. Left/Right move them 16 px (Shift: 64), Home/End go to
// the ends, and the callers' real clamps (clampLeft, clampWidth) hold the range, as they do for a drag.
import { expect, test, vi } from "vitest";

const holder: { current: unknown } = { current: null };
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useRef: () => holder }));

import type { ReactElement } from "react";
import { Grip, LEFT_MAX, LEFT_MIN, RIGHT_MIN, clampLeft, clampWidth } from "./RightSidebar";

type Props = Record<string, unknown> & { onKeyDown: (e: unknown) => void };
const press = (g: ReactElement<Props>, key: string, target: unknown, shiftKey = false) => {
  let stopped = false;
  g.props.onKeyDown({ key, shiftKey, currentTarget: target, preventDefault: () => (stopped = true) });
  return stopped;
};

test("T-711: the left grip is a focusable separator with its value, and the arrow keys resize it within its range", () => {
  let saved = 300;
  // MIRROR shell/window/Sidebar.tsx: onWidth saves clampLeft(w) when done; the wrapper is drawn 8 px wider than the sidebar.
  const grip = () => Grip({ side: "left", width: saved, min: LEFT_MIN, max: LEFT_MAX, label: "Resize the sidebar", className: "lside-grip", onWidth: (w, done) => done && (saved = clampLeft(w)) }) as ReactElement<Props>;
  const target = { previousElementSibling: { get offsetWidth() { return saved + 8; } } };
  expect(grip().props).toMatchObject({ role: "separator", "aria-orientation": "vertical", tabIndex: 0, "aria-valuenow": 300, "aria-valuemin": LEFT_MIN, "aria-valuemax": LEFT_MAX });
  expect(press(grip(), "ArrowRight", target)).toBe(true);
  expect(saved).toBe(316); // away from the left edge widens it
  press(grip(), "ArrowLeft", target, true);
  expect(saved).toBe(252); // Shift: 64 px
  expect(grip().props["aria-valuenow"]).toBe(252);
  press(grip(), "ArrowLeft", target, true);
  expect(saved).toBe(LEFT_MIN); // 188 clamps to the minimum
  press(grip(), "End", target);
  expect(saved).toBe(LEFT_MAX);
  press(grip(), "ArrowRight", target);
  expect(saved).toBe(LEFT_MAX); // the clamp holds past the end
  press(grip(), "Home", target);
  expect(saved).toBe(LEFT_MIN);
  expect(press(grip(), "a", target)).toBe(false); // other keys pass through untouched
  expect(press(grip(), "ArrowUp", target)).toBe(false);
  expect(saved).toBe(LEFT_MIN);
});

test("T-711: the right grip widens on Left, starts from the width as drawn (T-703), and keeps the workspace's room", () => {
  const W = 1400, left = 289 + 8;
  const fit = (w: number) => clampWidth(w, W, left); // MIRROR shell/window/Right.tsx
  let saved = 300;
  let drawn = 300;
  const grip = () => Grip({ side: "right", width: fit(saved), min: RIGHT_MIN, max: fit(1e4), label: "Resize the right sidebar", className: "rside-grip", onWidth: (w, done) => done && (saved = fit(w)) }) as ReactElement<Props>;
  const target = { parentElement: { get offsetWidth() { return drawn; } } };
  expect(grip().props["aria-valuemax"]).toBe(W - left - 400);
  press(grip(), "ArrowLeft", target);
  expect(saved).toBe(316);
  drawn = 250; // styles.css narrowed it below the saved width (T-703): the key moves from what is in view
  press(grip(), "ArrowRight", target);
  expect(saved).toBe(RIGHT_MIN); // 234 clamps to the minimum
  press(grip(), "End", target);
  expect(saved).toBe(W - left - 400);
  drawn = saved;
  press(grip(), "ArrowLeft", target, true);
  expect(saved).toBe(W - left - 400); // never into the workspace's reserved room
});
