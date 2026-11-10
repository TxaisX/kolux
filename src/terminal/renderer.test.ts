import { describe, expect, test } from "vitest";
import { attachRenderer, GPU_FIELD, gpuOn, onHeartbeat, onSlotFree, parkWhenHidden, PARK_AFTER_MS, quietSelection, renderNowHook, resumeHook, SYNC_WAIT_MS, watchResume, type ParkHooks, type RendererMode, type WebglLike } from "./renderer";

/** Lets the slot hand-on (queued as a microtask) run. */
const handOn = () => Promise.resolve();

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
      /** Time moves on but no timer fires (a background window's throttled timers). */
      skew(ms: number) {
        now += ms;
      },
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

  test("the freed slot lets another pane draw on the GPU; the woken pane draws plain while the pool is full", async () => {
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
    expect(hiddenPane.mode).toBe("dom"); // not inside the dispose itself
    await handOn();
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

  test("a pane revealed into a full pool evicts the pane hidden longest, never a visible one, and no waiter steals the slot", async () => {
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
    // q1 and q2 have been hidden 30 s and more, but their park timers have not fired yet (a busy or
    // throttled window): they would park anyway, so they may be evicted.
    q1.park.hidden(true);
    c.skew(1_000);
    q2.park.hidden(true);
    c.skew(PARK_AFTER_MS);
    p.park.hidden(false);
    expect([p.choice.mode, q1.choice.mode, q2.choice.mode, x.choice.mode, w.choice.mode, pool.live]).toEqual(["webgl", "dom", "webgl", "webgl", "dom", 3]);
    expect([q1.park.parked, q1.log, p.log]).toEqual([true, ["parked"], ["parked", "resume", "redraw webgl"]]);
    q1.park.hidden(false); // q2 is now the only hidden pane holding a context
    expect([q1.choice.mode, q2.choice.mode, q2.park.parked]).toEqual(["webgl", "dom", true]);
    c.pass(PARK_AFTER_MS); // the timers of evicted panes were cancelled: nothing parks twice
    await handOn();
    expect([q2.log, pool.live, w.choice.mode]).toEqual([["parked"], 3, "dom"]);
    for (const t of [p, q1, q2, x, w]) t.park.stop();
  });

  test("a pane hidden under 30 s is never evicted: the revealed pane draws plain and takes the slot when that pane parks", async () => {
    const pool = { max: 2, live: 0 };
    const c = clock();
    const pane = () => {
      const choice = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
      const log: string[] = [];
      const park = parkWhenHidden(choice, hooksFor([], log), { wait: c.wait, pool, now: c.now });
      return { choice, log, park };
    };
    const p = pane();
    const q = pane();
    p.park.hidden(true);
    c.pass(PARK_AFTER_MS); // p parks
    const x = pane(); // takes p's slot
    q.park.hidden(true);
    c.pass(PARK_AFTER_MS - 1);
    p.park.hidden(false);
    expect([p.choice.mode, p.choice.waiting, q.choice.mode, q.log]).toEqual(["dom", true, "webgl", []]);
    expect(p.log).toEqual(["parked", "resume", "redraw dom"]); // whole on the plain path
    c.pass(1); // q's own park, on time
    expect(p.choice.mode).toBe("dom");
    await handOn();
    expect([p.choice.mode, q.log, pool.live]).toEqual(["webgl", ["parked"], 2]);
    expect(p.log).toEqual(["parked", "resume", "redraw dom", "resume", "redraw webgl"]);
    for (const t of [p, q, x]) t.park.stop();
  });

  test("a reveal during synchronized output waits for it to end before taking a context and drawing", () => {
    const pool = { max: 12, live: 0 };
    const c = clock();
    const choice = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const log: string[] = [];
    let held = true;
    const frees: Array<() => void> = [];
    const hooks: ParkHooks = {
      ...hooksFor([], log),
      held: () => held,
      whenFree: (fn) => {
        frees.push(fn);
        return () => void frees.splice(frees.indexOf(fn), 1);
      },
    };
    const park = parkWhenHidden(choice, hooks, { wait: c.wait, pool, now: c.now });
    park.hidden(true);
    c.pass(PARK_AFTER_MS);
    park.hidden(false);
    expect([choice.mode, log, frees.length, pool.live]).toEqual(["dom", ["parked", "resume"], 1, 0]); // no context yet, nothing drawn blank
    park.hidden(false); // a second reveal call waits on the same end
    expect(frees.length).toBe(1);
    held = false;
    frees.shift()?.(); // synchronized output ends
    expect([choice.mode, log, pool.live]).toEqual(["webgl", ["parked", "resume", "resume", "redraw webgl"], 1]);

    held = true;
    park.hidden(true);
    c.pass(PARK_AFTER_MS);
    park.hidden(false);
    park.hidden(true); // hidden again before the end: the wait is dropped
    expect(frees.length).toBe(0);
    park.hidden(false);
    park.stop(); // and on unmount
    expect([frees.length, choice.mode]).toEqual([0, "dom"]);
    c.pass(SYNC_WAIT_MS); // its late timer went with it
    expect(choice.mode).toBe("dom");
  });

  test("a program that never ends synchronized output keeps the reveal waiting no longer than SYNC_WAIT_MS", () => {
    const pool = { max: 12, live: 0 };
    const c = clock();
    const choice = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const log: string[] = [];
    const frees: Array<() => void> = [];
    const hooks: ParkHooks = {
      ...hooksFor([], log),
      held: () => true,
      whenFree: (fn) => {
        frees.push(fn);
        return () => void frees.splice(frees.indexOf(fn), 1);
      },
    };
    const park = parkWhenHidden(choice, hooks, { wait: c.wait, pool, now: c.now });
    park.hidden(true);
    c.pass(PARK_AFTER_MS);
    park.hidden(false);
    c.pass(SYNC_WAIT_MS - 1);
    expect([choice.mode, log]).toEqual(["dom", ["parked", "resume"]]);
    c.pass(1);
    expect([choice.mode, log, frees.length]).toEqual(["webgl", ["parked", "resume", "resume", "redraw webgl"], 0]);
    expect(SYNC_WAIT_MS).toBe(1_100);
    park.stop();
  });

  test("a pane that evicts but still cannot draw on the GPU offers the evicted slot to a waiting pane", async () => {
    const pool = { max: 2, live: 0 };
    const c = clock();
    let loads = 0;
    const flaky = attachRenderer(
      {
        loadAddon() {
          if (++loads > 1) throw new Error("no gl"); // its second context is refused
        },
      },
      fakeWebgl,
      true,
      pool,
    );
    const fPark = parkWhenHidden(flaky, hooksFor([]), { wait: c.wait, pool, now: c.now });
    const old = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const oPark = parkWhenHidden(old, hooksFor([]), { wait: c.wait, pool, now: c.now });
    fPark.hidden(true);
    c.pass(PARK_AFTER_MS); // flaky parks
    const x = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool); // takes its slot
    const w = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool); // visible, waiting
    const wPark = parkWhenHidden(w, hooksFor([]), { wait: c.wait, pool, now: c.now });
    wPark.hidden(false);
    oPark.hidden(true);
    c.skew(PARK_AFTER_MS); // old would park anyway
    fPark.hidden(false); // evicts old quietly, then its own load is refused
    expect([flaky.mode, old.mode, w.mode, pool.live]).toEqual(["dom", "dom", "dom", 1]);
    await handOn();
    expect([w.mode, pool.live]).toEqual(["webgl", 2]); // the slot was not lost to the quiet eviction
    for (const p of [fPark, oPark, wPark]) p.stop();
    x.dispose();
  });

  test("with every slot held by a visible pane, the revealed pane draws plain and takes the next slot freed", async () => {
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
    await handOn();
    expect([late.mode, redraws, pool.live]).toEqual(["webgl", ["dom", "webgl"], 1]);
    park.stop();
    holderPark.stop();
  });

  test("a hidden waiter takes a freed slot only when shown; a lost or refused pane never takes one", async () => {
    const pool = { max: 1, live: 0 };
    const c = clock();
    const holder = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const waiter = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    const park = parkWhenHidden(waiter, hooksFor([]), { wait: c.wait, pool, now: c.now });
    park.hidden(true);
    holder.dispose();
    await handOn();
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
    await handOn();
    expect([lost.mode, lost.waiting, made, pool.live]).toEqual(["dom", false, 1, 0]);
    const refusing = attachRenderer({ loadAddon() { throw new Error("no gl"); } }, fakeWebgl, true, pool);
    const refusedPark = parkWhenHidden(refusing, hooksFor([]), { wait: c.wait, pool, now: c.now });
    attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool).dispose();
    await handOn();
    expect([refusing.mode, refusing.waiting, lost.mode, pool.live]).toEqual(["dom", false, "dom", 0]);
    lostPark.stop();
    refusedPark.stop();
  });

  test("slot-free listeners stop when asked and hear nothing of a quiet park", async () => {
    const pool = { max: 1, live: 0 };
    let calls = 0;
    const stop = onSlotFree(pool, () => void calls++);
    attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool).dispose();
    expect(calls).toBe(0); // offered after the current task, not inside the dispose
    await handOn();
    expect(calls).toBe(1);
    const b = attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool);
    expect(b.park(true)).toBe(true); // a quiet park keeps the freed slot for its caller
    await handOn();
    expect(calls).toBe(1);
    stop();
    attachRenderer({ loadAddon() {} }, fakeWebgl, true, pool).dispose();
    await handOn();
    expect(calls).toBe(1);
  });

  test("panes unmounted together never pass a slot between themselves", async () => {
    const pool = { max: 1, live: 0 };
    const c = clock();
    let made = 0;
    const make = () => (made++, fakeWebgl());
    const holder = attachRenderer({ loadAddon() {} }, make, true, pool);
    const waiter = attachRenderer({ loadAddon() {} }, make, true, pool);
    const park = parkWhenHidden(waiter, hooksFor([]), { wait: c.wait, pool, now: c.now });
    park.hidden(false);
    expect([waiter.waiting, made]).toEqual([true, 1]);
    // One commit: the holder's cleanup runs first, then the waiter's.
    holder.dispose();
    park.stop();
    waiter.dispose();
    await handOn();
    expect([made, pool.live]).toEqual([1, 0]); // no context made for a pane already going
  });

  test("a released addon's WebGL context is handed back at once, after dispose, and its loss is not a fallback", () => {
    const pool = { max: 12, live: 0 };
    const log: string[] = [];
    let lost: (() => void) | null = null;
    const addon = () => {
      const a = fakeWebgl();
      const gl = { getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => (log.push("lose"), lost?.()) } : null) };
      return Object.assign(a, {
        _renderer: { _gl: gl },
        onContextLoss(l: () => void) {
          lost = l;
        },
        dispose() {
          log.push("dispose");
        },
      });
    };
    const choice = attachRenderer({ loadAddon() {} }, addon, true, pool);
    const reasons: string[] = [];
    choice.onFallback((r) => reasons.push(r));
    expect(choice.park()).toBe(true);
    expect(log).toEqual(["dispose", "lose"]);
    expect([reasons, choice.wake(), pool.live]).toEqual([[], "webgl", 1]); // not refused: it takes a context again
    choice.dispose();
    expect(log).toEqual(["dispose", "lose", "dispose", "lose"]);
    expect([reasons, pool.live]).toEqual([[], 0]);
    // An addon without a reachable context (or one that throws) is simply disposed.
    const odd = attachRenderer({ loadAddon() {} }, () => Object.assign(fakeWebgl(), { _renderer: { _gl: { getExtension() { throw new Error("lost"); } } } }), true, pool);
    expect(() => odd.dispose()).not.toThrow();
    expect(pool.live).toBe(0);
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

describe("DT-C245 quietSelection", () => {
  const fake = () => {
    const calls: Array<boolean | undefined> = [];
    const service = { hasSelection: false, refresh: (linux?: boolean) => void calls.push(linux) };
    return { term: { _core: { _selectionService: service } }, service, calls };
  };
  test("a scroll with nothing selected asks for no redraw; a selection, and its removal, still do", () => {
    const { term, service, calls } = fake();
    const undo = quietSelection(term);
    expect(undo).not.toBeNull();
    service.refresh();
    service.refresh();
    expect(calls).toEqual([]);
    service.hasSelection = true;
    service.refresh(true);
    service.refresh();
    expect(calls).toEqual([true, undefined]);
    service.hasSelection = false;
    service.refresh(); // wipes the highlight once
    service.refresh();
    expect(calls.length).toBe(3);
    undo?.();
    service.refresh();
    expect(calls.length).toBe(4);
  });
  test("an xterm without the service is left alone", () => {
    expect(quietSelection({})).toBeNull();
    expect(quietSelection({ _core: { _selectionService: { refresh() {} } } })).toBeNull();
  });
});
