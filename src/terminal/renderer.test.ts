import { describe, expect, test } from "vitest";
import { attachRenderer, GPU_FIELD, gpuOn, onHeartbeat, onSlotFree, parkWhenHidden, PARK_AFTER_MS, renderNowHook, resumeHook, watchResume, type ParkHooks, type RendererMode, type WebglLike } from "./renderer";

function fakeWebgl(): WebglLike & { disposed: number; lose: () => void } {
  let lose = () => {};
  return {
    disposed: 0,
    dispose() {
      this.disposed++;
    },
    onContextLoss(l) {
      lose = l;
    },
    lose: () => lose(),
  };
}

test("GPU path is used when the WebGL addon loads", () => {
  const loaded: unknown[] = [];
  const choice = attachRenderer({ loadAddon: (a) => loaded.push(a) }, fakeWebgl);
  expect(choice.mode).toBe("webgl");
  expect(loaded).toHaveLength(1);
});

test("falls back to the plain path when WebGL refuses to load, and the pane keeps working", () => {
  const loaded: unknown[] = [];
  const choice = attachRenderer(
    {
      loadAddon: () => {
        throw new Error("no WebGL2 context");
      },
    },
    fakeWebgl,
  );
  expect(choice.mode).toBe("dom");
  expect(loaded).toHaveLength(0);
});

test("falls back when the addon constructor itself throws", () => {
  const choice = attachRenderer({ loadAddon: () => {} }, () => {
    throw new Error("webgl addon unavailable");
  });
  expect(choice.mode).toBe("dom");
});

test("a lost GPU context disposes the addon and reports the fallback", () => {
  const addon = fakeWebgl();
  const choice = attachRenderer({ loadAddon: () => {} }, () => addon);
  const reasons: string[] = [];
  choice.onFallback((r) => reasons.push(r));
  addon.lose();
  expect(addon.disposed).toBe(1);
  expect(reasons).toEqual(["context lost"]);
});

test("GPU can be switched off outright", () => {
  const choice = attachRenderer({ loadAddon: () => {} }, fakeWebgl, false);
  expect(choice.mode).toBe("dom");
});

// TERM-103 (T-067): at most six GPU contexts at a time, hidden tabs counted; the rest draw plain.
test("the seventh terminal draws plain while six hold a GPU context, and a closed one hands its slot on", () => {
  const pool = { max: 6, live: 0 };
  const hosts = Array.from({ length: 8 }, () => ({ loadAddon() {} }));
  const choices = hosts.map((h) => attachRenderer(h, fakeWebgl, true, pool));
  expect(choices.map((c) => c.mode)).toEqual(["webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "dom", "dom"]);
  expect(pool.live).toBe(6);
  choices[0].dispose();
  expect(pool.live).toBe(5);
  expect(attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool).mode).toBe("webgl");
  expect(pool.live).toBe(6);
});

test("a lost context frees its slot once, and a GPU failure counts nothing", () => {
  const pool = { max: 1, live: 0 };
  const gl = fakeWebgl();
  const first = attachRenderer({ loadAddon() {} }, () => gl, true, pool);
  expect(first.mode).toBe("webgl");
  gl.lose();
  gl.lose();
  first.dispose();
  expect(pool.live).toBe(0);
  const broken = attachRenderer({ loadAddon() { throw new Error("no gl"); } }, fakeWebgl, true, pool);
  expect(broken.mode).toBe("dom");
  expect(pool.live).toBe(0);
});

test("glyph caches can be reset on the GPU path and the ask is harmless on the plain path", () => {
  let cleared = 0;
  const gl = Object.assign(fakeWebgl(), { clearTextureAtlas: () => void cleared++ });
  const gpu = attachRenderer({ loadAddon() {} }, () => gl);
  gpu.clearGlyphs();
  expect(cleared).toBe(1);
  const plain = attachRenderer({ loadAddon() {} }, fakeWebgl, false);
  expect(() => plain.clearGlyphs()).not.toThrow();
});

test("the GPU setting defaults on and can be forced off", () => {
  expect(gpuOn({})).toBe(true);
  expect(gpuOn({ [GPU_FIELD]: true })).toBe(true);
  expect(gpuOn({ [GPU_FIELD]: false })).toBe(false);
});

test("a heartbeat that skips far ahead means the machine slept: the glyph caches are reset once", () => {
  let now = 1_000_000;
  let resumed = 0;
  const w = watchResume(() => resumed++, () => now, 30_000);
  now += 5_000;
  w.tick();
  now += 5_000;
  w.tick();
  expect(resumed).toBe(0);
  now += 90_000;
  w.tick();
  expect(resumed).toBe(1);
  now += 5_000;
  w.tick();
  expect(resumed).toBe(1);
});

describe("DT-C229: a long-hidden pane gives its GPU context back", () => {
  const hooksFor = (redraws: RendererMode[], log: string[] = []): ParkHooks => ({
    resume: () => void log.push("resume"),
    redraw: (m) => {
      log.push(`redraw ${m}`);
      redraws.push(m);
    },
    parked: () => void log.push("parked"),
  });
  const clock = () => {
    const waits = new Map<number, { fn: () => void; at: number }>();
    let now = 0;
    let n = 0;
    return {
      wait: (fn: () => void, ms: number) => {
        const id = n++;
        waits.set(id, { fn, at: now + ms });
        return () => void waits.delete(id);
      },
      now: () => now,
      pass(ms: number) {
        now += ms;
        for (const [id, w] of [...waits]) if (w.at <= now) (waits.delete(id), w.fn());
      },
    };
  };

  test("disposes the addon and frees the slot after 30 s hidden, and takes a new one on reveal with a redraw", () => {
    const pool = { max: 12, live: 0 };
    const made: ReturnType<typeof fakeWebgl>[] = [];
    const loaded: unknown[] = [];
    const choice = attachRenderer({ loadAddon: (a) => loaded.push(a) }, () => (made.push(fakeWebgl()), made[made.length - 1]), true, pool);
    const c = clock();
    const redraws: RendererMode[] = [];
    const park = parkWhenHidden(choice, hooksFor(redraws), { wait: c.wait, pool });
    park.hidden(true);
    c.pass(PARK_AFTER_MS - 1);
    expect([made[0].disposed, pool.live, choice.mode]).toEqual([0, 1, "webgl"]); // still held under 30 s
    c.pass(1);
    expect([made[0].disposed, pool.live, choice.mode, park.parked]).toEqual([1, 0, "dom", true]);
    park.hidden(false);
    expect(loaded).toHaveLength(2); // the same attach path loads a fresh addon
    expect([pool.live, choice.mode, made[1].disposed]).toEqual([1, "webgl", 0]);
    expect(redraws).toEqual(["webgl"]); // the pane repaints once, in the reveal
  });

  test("a pane shown again inside 30 s keeps its context and is not redrawn", () => {
    const pool = { max: 12, live: 0 };
    const gl = fakeWebgl();
    const choice = attachRenderer({ loadAddon() {} }, () => gl, true, pool);
    const c = clock();
    const redraws: RendererMode[] = [];
    const park = parkWhenHidden(choice, hooksFor(redraws), { wait: c.wait, pool });
    park.hidden(true);
    c.pass(10_000);
    park.hidden(false);
    c.pass(PARK_AFTER_MS);
    expect([gl.disposed, pool.live, redraws.length]).toEqual([0, 1, 0]);
  });

  test("the freed slot lets another pane draw on the GPU; the woken pane draws plain while the pool is full", () => {
    const pool = { max: 1, live: 0 };
    const hiddenPane = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const c = clock();
    const redraws: RendererMode[] = [];
    const park = parkWhenHidden(hiddenPane, hooksFor(redraws), { wait: c.wait, pool });
    park.hidden(true);
    c.pass(PARK_AFTER_MS);
    const other = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    expect(other.mode).toBe("webgl");
    park.hidden(false);
    expect([hiddenPane.mode, hiddenPane.waiting, redraws]).toEqual(["dom", true, ["dom"]]); // still redrawn whole, on the plain path
    other.dispose(); // the freed slot goes to the visible pane that was refused for a full pool
    expect([hiddenPane.mode, redraws, pool.live]).toEqual(["webgl", ["dom", "webgl"], 1]);
    park.stop();
    hiddenPane.dispose();
    expect(pool.live).toBe(0);
  });

  test("a plain pane and a lost context are never parked or re-attached", () => {
    const pool = { max: 12, live: 0 };
    const plain = attachRenderer({ loadAddon() {} }, fakeWebgl, false, pool);
    expect([plain.park(), plain.wake()]).toEqual([false, "dom"]);
    const gl = fakeWebgl();
    let made = 0;
    const lost = attachRenderer({ loadAddon() {} }, () => (made++, gl), true, pool);
    gl.lose();
    expect([lost.park(), lost.wake(), made, pool.live]).toEqual([false, "dom", 1, 0]);
  });

  test("a disposed pane's late timer does nothing and a dispose after park counts nothing twice", () => {
    const pool = { max: 12, live: 0 };
    const choice = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const c = clock();
    const park = parkWhenHidden(choice, hooksFor([]), { wait: c.wait, pool });
    park.hidden(true);
    c.pass(PARK_AFTER_MS);
    choice.dispose();
    expect(choice.wake()).toBe("dom");
    expect(pool.live).toBe(0);
    park.hidden(true);
    park.stop();
    c.pass(PARK_AFTER_MS);
    expect(pool.live).toBe(0);
  });

  test("on reveal xterm resumes first, then the context is taken, then the pane repaints; a park reports plain", () => {
    const pool = { max: 12, live: 0 };
    const choice = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const c = clock();
    const log: string[] = [];
    const park = parkWhenHidden(choice, hooksFor([], log), { wait: c.wait, pool });
    park.hidden(true);
    c.pass(PARK_AFTER_MS);
    expect(log).toEqual(["parked"]); // the pane reports the plain path at once (terminal_diagnostics)
    park.hidden(false);
    expect(log).toEqual(["parked", "resume", "redraw webgl"]);
    park.stop();
  });

  test("a pane revealed into a full pool evicts the pane hidden longest, never a visible one, and no waiter steals the slot", () => {
    const pool = { max: 3, live: 0 };
    const c = clock();
    const pane = () => {
      const choice = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
      const log: string[] = [];
      const park = parkWhenHidden(choice, hooksFor([], log), { wait: c.wait, pool, now: c.now });
      return { choice, log, park };
    };
    const p = pane();
    const q1 = pane();
    const q2 = pane();
    p.park.hidden(true);
    c.pass(PARK_AFTER_MS); // p parks; its slot goes to a new visible pane
    const x = pane();
    const w = pane(); // visible, refused for a full pool
    expect([x.choice.mode, w.choice.mode, w.choice.waiting, pool.live]).toEqual(["webgl", "dom", true, 3]);
    q1.park.hidden(true);
    c.pass(1_000);
    q2.park.hidden(true);
    c.pass(1_000);
    p.park.hidden(false);
    expect([p.choice.mode, q1.choice.mode, q2.choice.mode, x.choice.mode, w.choice.mode, pool.live]).toEqual(["webgl", "dom", "webgl", "webgl", "dom", 3]);
    expect([q1.park.parked, q1.log, p.log]).toEqual([true, ["parked"], ["parked", "resume", "redraw webgl"]]);
    q1.park.hidden(false); // q2 is now the only hidden pane holding a context
    expect([q1.choice.mode, q2.choice.mode, q2.park.parked]).toEqual(["webgl", "dom", true]);
    c.pass(PARK_AFTER_MS); // the timers of evicted panes were cancelled: nothing parks twice
    expect([q2.log, pool.live]).toEqual([["parked"], 3]);
    for (const t of [p, q1, q2, x, w]) t.park.stop();
  });

  test("with every slot held by a visible pane, the revealed pane draws plain and takes the next slot freed", () => {
    const pool = { max: 1, live: 0 };
    const c = clock();
    const holder = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const holderPark = parkWhenHidden(holder, hooksFor([]), { wait: c.wait, pool, now: c.now });
    const late = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const redraws: RendererMode[] = [];
    const park = parkWhenHidden(late, hooksFor(redraws), { wait: c.wait, pool, now: c.now });
    park.hidden(false);
    expect([late.mode, holder.mode, redraws]).toEqual(["dom", "webgl", ["dom"]]);
    holder.dispose();
    expect([late.mode, redraws, pool.live]).toEqual(["webgl", ["dom", "webgl"], 1]);
    park.stop();
    holderPark.stop();
  });

  test("a hidden waiter takes a freed slot only when shown; a lost or refused pane never takes one", () => {
    const pool = { max: 1, live: 0 };
    const c = clock();
    const holder = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const waiter = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const park = parkWhenHidden(waiter, hooksFor([]), { wait: c.wait, pool, now: c.now });
    park.hidden(true);
    holder.dispose();
    expect([waiter.mode, pool.live]).toEqual(["dom", 0]);
    park.hidden(false);
    expect([waiter.mode, pool.live]).toEqual(["webgl", 1]);
    park.stop();
    waiter.dispose();

    const gl = fakeWebgl();
    let made = 0;
    const lost = attachRenderer({ loadAddon() {} }, () => (made++, gl), true, pool);
    const lostPark = parkWhenHidden(lost, hooksFor([]), { wait: c.wait, pool, now: c.now });
    gl.lose(); // frees the slot; the lost pane must not take it back
    expect([lost.mode, lost.waiting, made, pool.live]).toEqual(["dom", false, 1, 0]);
    const refusing = attachRenderer({ loadAddon() { throw new Error("no gl"); } }, fakeWebgl, true, pool);
    const refusedPark = parkWhenHidden(refusing, hooksFor([]), { wait: c.wait, pool, now: c.now });
    attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool).dispose();
    expect([refusing.mode, refusing.waiting, lost.mode, pool.live]).toEqual(["dom", false, "dom", 0]);
    lostPark.stop();
    refusedPark.stop();
  });

  test("slot-free listeners stop when asked and hear nothing of a quiet park", () => {
    const pool = { max: 1, live: 0 };
    let calls = 0;
    const stop = onSlotFree(pool, () => void calls++);
    attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool).dispose();
    expect(calls).toBe(1);
    const b = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    expect(b.park(true)).toBe(true); // a quiet park keeps the freed slot for its caller
    expect(calls).toBe(1);
    stop();
    attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool).dispose();
    expect(calls).toBe(1);
  });

  test("draws the pending rows now through xterm's own debouncer step, and declines without one", () => {
    const cancelled: number[] = [];
    const rendered: number[] = [];
    const debouncer = {
      _animationFrame: 7 as number | undefined,
      _innerRefresh() {
        this._animationFrame = undefined;
        rendered.push(1);
      },
    };
    const hook = renderNowHook({ _core: { _renderService: { _renderDebouncer: debouncer } } }, (id) => void cancelled.push(id));
    hook?.();
    expect([cancelled, rendered, debouncer._animationFrame]).toEqual([[7], [1], undefined]);
    expect(renderNowHook({})).toBeNull();
    expect(renderNowHook(null)).toBeNull();
  });

  test("resumes xterm through its own observer handler when it has one, and declines otherwise", () => {
    const seen: unknown[] = [];
    const service = {
      paused: true,
      _handleIntersectionChange(e: { isIntersecting: boolean }) {
        this.paused = !e.isIntersecting;
        seen.push(e);
      },
    };
    const hook = resumeHook({ _core: { _renderService: service } });
    expect(hook).not.toBeNull();
    hook?.();
    expect(service.paused).toBe(false);
    expect(seen).toHaveLength(1);
    expect(resumeHook({})).toBeNull();
    expect(resumeHook(null)).toBeNull();
  });
});

test("every pane's resume watch rides one window-level heartbeat that runs only while a pane listens", () => {
  const live = new Set<() => void>();
  const timers = { every: (fn: () => void) => (live.add(fn), fn), stop: (h: unknown) => void live.delete(h as () => void) };
  let now = 1_000_000;
  const resumed = [0, 0];
  const a = watchResume(() => resumed[0]++, () => now);
  const b = watchResume(() => resumed[1]++, () => now);
  const offA = onHeartbeat(a.tick, timers);
  const offB = onHeartbeat(b.tick, timers);
  expect(live.size).toBe(1); // one timer for both panes
  now += 5_000;
  live.forEach((fn) => fn());
  now += 90_000; // the machine slept
  live.forEach((fn) => fn());
  expect(resumed).toEqual([1, 1]);
  offA();
  expect(live.size).toBe(1);
  offB();
  expect(live.size).toBe(0);
  const offC = onHeartbeat(() => {}, timers);
  expect(live.size).toBe(1);
  offC();
});
