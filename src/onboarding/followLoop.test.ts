// The tour's frame loop rests when nothing changes and wakes on what can move a target (TourPanel, DT-C244).
import { afterEach, describe, expect, it, vi } from "vitest";
import src from "./Tours.tsx?raw";
import { IDLE_FRAMES, WAKE_ON, restingLoop, wakeOnChange } from "./followLoop";

// A frame clock the test turns by hand: `frames()` runs the queued callback once, like one screen refresh.
function clock() {
  let next = 1;
  const q = new Map<number, () => void>();
  return {
    raf: (cb: () => void) => (q.set(next, cb), next++),
    caf: (id: number) => void q.delete(id),
    queued: () => q.size,
    frames(n: number) {
      for (let i = 0; i < n && q.size; i++) {
        const [id, cb] = [...q][0];
        q.delete(id);
        cb();
      }
    },
  };
}

describe("restingLoop", () => {
  it("measures every frame while things change, rests after IDLE_FRAMES calm frames, and queues nothing then", () => {
    const c = clock();
    let calls = 0;
    let busy = 5; // five frames of movement, then calm
    const loop = restingLoop(() => (calls++, busy-- > 0), { raf: c.raf, caf: c.caf });
    loop.wake();
    expect(loop.running).toBe(true);
    c.frames(1000);
    expect(calls).toBe(5 + IDLE_FRAMES);
    expect(loop.running).toBe(false);
    expect(c.queued()).toBe(0);
  });

  it("a wake restarts a resting loop, and many wakes in one frame queue one frame", () => {
    const c = clock();
    let calls = 0;
    const loop = restingLoop(() => (calls++, false), { raf: c.raf, caf: c.caf });
    loop.wake();
    c.frames(1000);
    const rested = calls;
    expect(rested).toBe(IDLE_FRAMES);
    loop.wake();
    loop.wake();
    loop.wake();
    expect(c.queued()).toBe(1);
    c.frames(1000);
    expect(calls).toBe(rested * 2);
  });

  it("a wake while the loop runs restarts the calm count, so a late move is still followed", () => {
    const c = clock();
    let calls = 0;
    const loop = restingLoop(() => (calls++, false), { raf: c.raf, caf: c.caf });
    loop.wake();
    c.frames(IDLE_FRAMES - 1);
    loop.wake();
    c.frames(1000);
    expect(calls).toBe(IDLE_FRAMES - 1 + IDLE_FRAMES);
  });

  it("stop cancels the queued frame for good, even for a later wake", () => {
    const c = clock();
    let calls = 0;
    const loop = restingLoop(() => (calls++, true), { raf: c.raf, caf: c.caf });
    loop.wake();
    c.frames(3);
    loop.stop();
    expect(c.queued()).toBe(0);
    loop.wake();
    expect(c.queued()).toBe(0);
    expect(calls).toBe(3);
  });

  it("a measure that ends the loop (the tour moved on) is not followed by another frame", () => {
    const c = clock();
    const loop = restingLoop(() => (loop.stop(), true), { raf: c.raf, caf: c.caf });
    loop.wake();
    c.frames(10);
    expect(c.queued()).toBe(0);
  });

  it("a wake from inside measure (a reveal click) keeps one frame chain, so measure runs once per frame", () => {
    const c = clock();
    let measures = 0;
    const loop = restingLoop(
      () => {
        measures++;
        if (measures === 1) loop.wake();
        return true;
      },
      { raf: c.raf, caf: c.caf },
    );
    loop.wake();
    for (let i = 0; i < 5; i++) {
      c.frames(1);
      expect(c.queued()).toBe(1);
    }
    expect(measures).toBe(5);
    loop.stop();
  });
});

describe("wakeOnChange", () => {
  afterEach(() => vi.unstubAllGlobals());

  function targets() {
    const on = new Map<string, Set<() => void>>();
    const opts: unknown[] = [];
    const make = () => ({
      hidden: false,
      addEventListener: (e: string, f: () => void, o?: unknown) => {
        opts.push(o);
        (on.get(e) ?? on.set(e, new Set()).get(e)!).add(f);
      },
      removeEventListener: (e: string, f: () => void) => void on.get(e)?.delete(f),
    });
    return { win: make(), doc: make(), on, opts };
  }
  const size = (on: Map<string, Set<() => void>>) => [...on.values()].reduce((n, s) => n + s.size, 0);

  it("wakes on resize, scroll, transitions, releases and drags, with passive captured listeners", () => {
    const t = targets();
    let wakes = 0;
    wakeOnChange(() => wakes++, { win: t.win as never, doc: t.doc as never });
    for (const e of WAKE_ON) {
      t.on.get(e)!.forEach((f) => f());
    }
    expect(wakes).toBe(WAKE_ON.length);
    // A pointer move wakes only while a button is held (a drag), not on every mouse move.
    t.on.get("pointermove")!.forEach((f) => (f as (e: unknown) => void)({ buttons: 0 }));
    expect(wakes).toBe(WAKE_ON.length);
    t.on.get("pointermove")!.forEach((f) => (f as (e: unknown) => void)({ buttons: 1 }));
    expect(wakes).toBe(WAKE_ON.length + 1);
    for (const o of t.opts.slice(0, WAKE_ON.length + 1)) expect(o).toMatchObject({ capture: true, passive: true });
  });

  it("wakes when the window comes back from hidden, not when it hides", () => {
    const t = targets();
    let wakes = 0;
    wakeOnChange(() => wakes++, { win: t.win as never, doc: t.doc as never });
    t.doc.hidden = true;
    t.on.get("visibilitychange")!.forEach((f) => f());
    expect(wakes).toBe(0);
    t.doc.hidden = false;
    t.on.get("visibilitychange")!.forEach((f) => f());
    expect(wakes).toBe(1);
  });

  it("the stop removes every listener and disconnects the observers", () => {
    const t = targets();
    const disconnected: string[] = [];
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() { disconnected.push("resize"); } });
    vi.stubGlobal("MutationObserver", class { observe() {} disconnect() { disconnected.push("mutation"); } });
    const stop = wakeOnChange(() => {}, { win: t.win as never, doc: t.doc as never, watch: [{} as Element], root: {} as Element });
    expect(size(t.on)).toBeGreaterThan(WAKE_ON.length);
    stop();
    expect(size(t.on)).toBe(0);
    expect(disconnected.sort()).toEqual(["mutation", "resize"]);
  });

  it("layout changes wake it, except inside the tour's own card and ring and in a terminal", () => {
    const t = targets();
    let wakes = 0;
    let seen: ((r: unknown[]) => void) | null = null;
    vi.stubGlobal("Element", class {});
    vi.stubGlobal("MutationObserver", class { constructor(f: (r: unknown[]) => void) { seen = f; } observe() {} disconnect() {} });
    wakeOnChange(() => wakes++, { win: t.win as never, doc: t.doc as never, root: {} as Element });
    // A node is `inside` the ignored parts when closest(selector) finds one.
    const node = (inside: boolean) => Object.assign(new (globalThis as unknown as { Element: new () => object }).Element(), { closest: () => (inside ? {} : null) });
    seen!([{ target: node(true) }, { target: node(true) }]);
    expect(wakes).toBe(0);
    seen!([{ target: node(true) }, { target: node(false) }]);
    expect(wakes).toBe(1);
  });
});

describe("TourPanel wiring", () => {
  it("follows its target through the resting loop, not a frame loop that never stops", () => {
    expect(src).toMatch(/restingLoop\(measure\)/);
    expect(src).toMatch(/wakeOnChange\(loop\.wake/);
    expect(src).not.toMatch(/requestAnimationFrame/);
  });
});
