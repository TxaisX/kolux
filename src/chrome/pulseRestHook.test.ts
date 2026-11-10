// DT-C239: the usePulseRest hook as a real component sees it (rests after 10 s of quiet, wakes on input, wakes when
// a tour moves to another step, shows no stale resting class on the render a new run starts). The repo has no jsdom,
// so the page is src/tasks/fakeDom with a window whose listeners the test can fire, and the clock is vitest's.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import { type FakeNode, installDom } from "../tasks/fakeDom";
import { PULSE_REST_MS, WAKE_EVENTS, usePulseRest } from "./pulseRest";

type Fn = (e?: unknown) => void;
let handlers: Map<string, Set<Fn>>;
let seenOpts: unknown[];
let root: Root;
let container: FakeNode;
let classes: string[];
let animating: boolean;
let mounted: boolean;

function Probe({ active, wake }: { active: boolean; wake?: number }) {
  const [rest, ref] = usePulseRest<HTMLDivElement>(active, wake);
  classes.push(rest ? "resting" : "pulsing");
  return createElement("div", { ref, className: rest ? "ring resting" : "ring" });
}

beforeEach(async () => {
  vi.useFakeTimers();
  handlers = new Map();
  seenOpts = [];
  classes = [];
  animating = false;
  mounted = true;
  const { doc, win } = installDom();
  win.addEventListener = (e: string, f: Fn, o: unknown) => {
    seenOpts.push(o);
    (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(f);
  };
  win.removeEventListener = (e: string, f: Fn) => void handlers.get(e)?.delete(f);
  const { createRoot } = await import("react-dom/client");
  container = doc.createElement("div");
  doc.body.appendChild(container);
  root = createRoot(container as unknown as Element);
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  vi.useRealTimers();
});

// The element, with a stand-in for a running CSS animation whose iteration ends only when a test fires the event.
const div = () => {
  const d = container.childNodes[0];
  d.getAnimations = () => (animating ? [{ playState: "running" }] : []);
  return d;
};
const cls = () => String(div().attrs.className ?? div().attrs.class ?? "");
const render = (active: boolean, wake?: number) => {
  act(() => root.render(createElement(Probe, { active, wake })));
  div();
};
const input = (e = "pointermove") => act(() => handlers.get(e)?.forEach((f) => f()));
const idle = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

it("pulses on mount, rests after 10 s idle, and wakes on input", () => {
  render(true);
  expect(cls()).toBe("ring");
  idle(PULSE_REST_MS - 1);
  expect(cls()).toBe("ring");
  idle(1); // no running animation (reduced motion): nothing to wait for
  expect(cls()).toBe("ring resting");
  input();
  expect(cls()).toBe("ring");
  idle(PULSE_REST_MS);
  expect(cls()).toBe("ring resting");
});

it("while an animation runs, the rest waits for its next cycle end (or 2 s)", () => {
  animating = true;
  render(true);
  idle(PULSE_REST_MS);
  expect(cls()).toBe("ring"); // due, but mid-cycle
  idle(2000);
  expect(cls()).toBe("ring resting"); // fallback
  input("keydown");
  idle(PULSE_REST_MS);
  expect(cls()).toBe("ring");
  act(() => div().listeners.animationiteration?.forEach((l) => l.fn({})));
  expect(cls()).toBe("ring resting");
});

it("registers passive capture listeners for every wake event, and removes them with the timers on unmount", () => {
  render(true);
  for (const e of WAKE_EVENTS) expect(handlers.get(e)?.size).toBe(1);
  expect(seenOpts).toHaveLength(WAKE_EVENTS.length);
  for (const o of seenOpts) expect(o).toMatchObject({ capture: true, passive: true });
  act(() => root.unmount());
  mounted = false;
  for (const e of WAKE_EVENTS) expect(handlers.get(e)?.size ?? 0).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("a new wake key (a tour moving to another step) wakes a resting pulse with a fresh quiet period", () => {
  render(true, 0);
  idle(PULSE_REST_MS);
  expect(cls()).toBe("ring resting");
  render(true, 1);
  expect(cls()).toBe("ring");
  idle(PULSE_REST_MS - 1);
  expect(cls()).toBe("ring");
  idle(1);
  expect(cls()).toBe("ring resting");
});

it("no render shows a stale resting class: turning on again, or a new key, pulses from the first render", () => {
  render(true, 0);
  idle(PULSE_REST_MS);
  expect(cls()).toBe("ring resting");
  render(false);
  expect(cls()).toBe("ring");
  classes.length = 0;
  render(true, 0);
  expect(cls()).toBe("ring");
  expect(classes).not.toContain("resting");
});
