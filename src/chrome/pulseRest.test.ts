import { describe, expect, it } from "vitest";
import { PULSE_REST_MS, WAKE_EVENTS, nextCycleEnd, pulseRest } from "./pulseRest";

// A hand-driven clock and timer list, so the rest is checked without real waiting.
function rig() {
  let t = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const wait = (fn: () => void, ms: number) => {
    const x = { at: t + ms, fn, live: true };
    timers.push(x);
    return () => void (x.live = false);
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      t = next.at;
      next.live = false;
      next.fn();
    }
    t = end;
  };
  const listeners = new Map<string, Set<() => void>>();
  const input = {
    addEventListener: (e: string, f: () => void) => void (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(f),
    removeEventListener: (e: string, f: () => void) => void listeners.get(e)?.delete(f),
  } as unknown as Window;
  const fire = (e: string) => listeners.get(e)?.forEach((f) => f());
  return { wait, advance, input, fire, listeners, now: () => t };
}

describe("pulseRest (DT-C239)", () => {
  it("pulses at once, rests after the quiet period once the running cycle ends, and wakes on input", () => {
    const r = rig();
    const seen: boolean[] = [];
    let finishCycle: (() => void) | null = null;
    const stop = pulseRest((on) => seen.push(on), (then) => ((finishCycle = then), () => (finishCycle = null)), { input: r.input, wait: r.wait, now: r.now });
    expect(seen).toEqual([true]);
    r.advance(PULSE_REST_MS - 1);
    expect(seen).toEqual([true]);
    r.advance(1);
    // The rest is due but waits for the cycle in progress: no half-faded stop.
    expect(seen).toEqual([true]);
    expect(finishCycle).not.toBeNull();
    finishCycle!();
    expect(seen).toEqual([true, false]);
    r.fire("pointermove");
    expect(seen).toEqual([true, false, true]);
    stop();
  });

  it("input during the quiet period pushes the rest back", () => {
    const r = rig();
    const seen: boolean[] = [];
    const stop = pulseRest((on) => seen.push(on), (then) => (then(), () => {}), { input: r.input, wait: r.wait, now: r.now });
    r.advance(PULSE_REST_MS - 100);
    r.fire("keydown");
    r.advance(PULSE_REST_MS - 100);
    expect(seen).toEqual([true]);
    r.advance(200);
    expect(seen).toEqual([true, false]);
    stop();
  });

  it("input while the cycle is finishing keeps it pulsing", () => {
    const r = rig();
    const seen: boolean[] = [];
    let cancelled = false;
    const stop = pulseRest((on) => seen.push(on), () => () => void (cancelled = true), { input: r.input, wait: r.wait, now: r.now });
    r.advance(PULSE_REST_MS);
    r.fire("wheel");
    expect(cancelled).toBe(true);
    expect(seen[seen.length - 1]).toBe(true);
    expect(seen).not.toContain(false);
    stop();
  });

  it("the stop removes every listener and timer", () => {
    const r = rig();
    const seen: boolean[] = [];
    const stop = pulseRest((on) => seen.push(on), (then) => (then(), () => {}), { input: r.input, wait: r.wait, now: r.now });
    for (const e of WAKE_EVENTS) expect(r.listeners.get(e)?.size).toBe(1);
    stop();
    for (const e of WAKE_EVENTS) expect(r.listeners.get(e)?.size ?? 0).toBe(0);
    r.advance(PULSE_REST_MS * 3);
    expect(seen).toEqual([true]);
  });
});

describe("nextCycleEnd", () => {
  it("calls through at once when nothing animates (no element, or reduced motion)", () => {
    let n = 0;
    nextCycleEnd(null, () => n++);
    const el = { getAnimations: () => [] } as unknown as HTMLElement;
    nextCycleEnd(el, () => n++);
    expect(n).toBe(2);
  });

  it("waits for the running animation's next cycle, once", () => {
    let fire: (() => void) | null = null;
    const el = {
      getAnimations: () => [{ playState: "running" }],
      addEventListener: (_: string, f: () => void) => (fire = f),
      removeEventListener: () => (fire = null),
    } as unknown as HTMLElement;
    let n = 0;
    nextCycleEnd(el, () => n++, 60_000);
    expect(n).toBe(0);
    const f = fire!;
    f();
    f();
    expect(n).toBe(1);
  });
});
