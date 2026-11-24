// LAG-08 (board test, locked): who holds one of the window's GPU slots when there are more panes than slots.
// Counts only: contexts made, contexts disposed, slots live. Time is a fake clock; no real timers.
import { describe, expect, test } from "vitest";
import { pickSlotVictim, type SlotHolder } from "./gpuSlots";
import { attachRenderer, parkWhenHidden, PARK_AFTER_MS, SWAP_AFTER_MS, type GpuPool, type ParkHooks, type RendererMode, type WebglLike } from "./renderer";

const handOn = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

type Named = SlotHolder & { name: string };
const holder = (name: string, hiddenSince: number | null, holds = true): Named => ({ name, hiddenSince, holds: () => holds });

function clock() {
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
      for (const [id, w] of [...waits].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])) {
        if (w.at <= now && waits.has(id)) {
          waits.delete(id);
          w.fn();
        }
      }
    },
  };
}

type Pane = { name: string; choice: ReturnType<typeof attachRenderer>; park: ReturnType<typeof parkWhenHidden>; redraws: RendererMode[] };

function world(max: number, after = PARK_AFTER_MS) {
  const pool: GpuPool = { max, live: 0 };
  const c = clock();
  let makes = 0;
  let disposes = 0;
  const all: Pane[] = [];
  const pane = (name: string): Pane => {
    const redraws: RendererMode[] = [];
    const choice = attachRenderer(
      { loadAddon() {} },
      (): WebglLike => {
        makes++;
        return {
          dispose() {
            disposes++;
          },
          onContextLoss() {},
        };
      },
      true,
      pool,
      true, // starts plain, as every pane of the app does (bug 1155)
    );
    const hooks: ParkHooks = { resume() {}, redraw: (m) => void redraws.push(m), parked() {} };
    const park = parkWhenHidden(choice, hooks, { after, wait: c.wait, pool, now: c.now });
    park.hidden(true); // mounted hidden (FT-3): no slot until it is shown
    const p = { name, choice, park, redraws };
    all.push(p);
    return p;
  };
  const folder = (tag: string, n: number) => Array.from({ length: n }, (_, i) => pane(`${tag}${i}`));
  const show = (ps: Pane[]) => ps.forEach((p) => p.park.hidden(false));
  const hide = (ps: Pane[]) => ps.forEach((p) => p.park.hidden(true));
  const modes = (ps: Pane[]) => ps.map((p) => p.choice.mode);
  return { pool, c, all, folder, show, hide, modes, counts: () => ({ makes, disposes }) };
}

const six = (m: RendererMode) => Array.from({ length: 6 }, () => m);

describe("LAG-08 GPU slots", () => {
  test("pickSlotVictim picks the hidden pane holding a slot that was hidden longest, never a shown pane or one without a slot", () => {
    const shownHolder = holder("shown", null);
    const oldNoSlot = holder("oldNoSlot", 0, false);
    const a = holder("a", 50);
    const b = holder("b", 20);
    const c = holder("c", 20); // same moment as b: the first one met wins
    const panes = new Set<Named>([shownHolder, oldNoSlot, a, b, c]);
    expect(pickSlotVictim(panes, 100, () => 0)?.name).toBe("b");
    expect(pickSlotVictim([a, c, b], 100, () => 0)?.name).toBe("c");
    expect(pickSlotVictim([shownHolder, oldNoSlot], 100, () => 0)).toBeNull();
    expect(pickSlotVictim([], 100, () => 0)).toBeNull();
  });

  test("pickSlotVictim honours each pane's own minimum hidden time, inclusive, and changes nothing", () => {
    const a = holder("a", 0);
    const b = holder("b", 40);
    const min = (p: Named) => (p.name === "a" ? 200 : 60);
    expect(pickSlotVictim([a, b], 99, min)).toBeNull(); // a hidden 99 < 200, b hidden 59 < 60
    expect(pickSlotVictim([a, b], 100, min)?.name).toBe("b"); // b hidden exactly 60
    expect(pickSlotVictim([a, b], 200, min)?.name).toBe("a"); // both qualify: a was hidden longer
    expect([a.hiddenSince, b.hiddenSince, a.holds(), b.holds()]).toEqual([0, 40, true, true]);
  });

  test("a folder switch into a full pool: within SWAP_AFTER_MS every shown pane draws on the GPU and the folder hidden longest gives its slots", async () => {
    const w = world(12);
    const A = w.folder("A", 6);
    const B = w.folder("B", 6);
    const C = w.folder("C", 6);
    w.show(A);
    expect(w.modes(A)).toEqual(six("webgl"));
    w.c.pass(1_000);
    w.hide(A);
    w.show(B);
    expect([w.modes(B), w.pool.live]).toEqual([six("webgl"), 12]);
    w.c.pass(5_000); // A has been hidden 5 s: far under PARK_AFTER_MS
    w.hide(B);
    w.show(C);
    expect(w.modes(C)).toEqual(six("dom")); // the pool is full: plain for a moment, nobody evicted at once
    expect(w.counts()).toEqual({ makes: 12, disposes: 0 });
    w.c.pass(SWAP_AFTER_MS);
    await handOn();
    expect(w.modes(C)).toEqual(six("webgl"));
    expect(w.modes(B)).toEqual(six("webgl")); // hidden most recently: keeps its slots
    expect(w.modes(A)).toEqual(six("dom")); // hidden longest: gave its slots back
    expect([w.pool.live, w.counts()]).toEqual([12, { makes: 18, disposes: 6 }]);
    for (const p of C) expect(p.redraws).toEqual(["dom", "webgl"]); // one repaint plain, one on the GPU
    for (const p of [...A, ...B, ...C]) p.park.stop();
  });

  test("switching back to a folder that kept its slots makes no context and releases none; the next switch evicts the folder hidden longest", async () => {
    const w = world(12);
    const A = w.folder("A", 6);
    const B = w.folder("B", 6);
    const C = w.folder("C", 6);
    w.show(A);
    w.c.pass(1_000);
    w.hide(A);
    w.show(B);
    w.c.pass(1_000);
    w.hide(B);
    w.show(C);
    w.c.pass(SWAP_AFTER_MS);
    await handOn();
    expect(w.counts()).toEqual({ makes: 18, disposes: 6 });
    const bRedraws = B.map((p) => p.redraws.length);
    w.hide(C);
    w.show(B); // B kept its slots
    w.c.pass(SWAP_AFTER_MS * 3);
    await handOn();
    expect(w.counts()).toEqual({ makes: 18, disposes: 6 });
    expect(w.modes(B)).toEqual(six("webgl"));
    expect(B.map((p) => p.redraws.length)).toEqual(bRedraws); // not even repainted
    expect(w.modes(C)).toEqual(six("webgl")); // hidden, still holding
    w.c.pass(1_000);
    w.hide(B);
    w.show(A); // A was evicted; C was hidden before B
    w.c.pass(SWAP_AFTER_MS);
    await handOn();
    expect([w.modes(A), w.modes(B), w.modes(C)]).toEqual([six("webgl"), six("webgl"), six("dom")]);
    expect([w.pool.live, w.counts()]).toEqual([12, { makes: 24, disposes: 12 }]);
    for (const p of [...A, ...B, ...C]) p.park.stop();
  });

  test("a quick look at another folder (shown under SWAP_AFTER_MS) evicts nobody and makes no context", async () => {
    const w = world(12);
    const A = w.folder("A", 6);
    const B = w.folder("B", 6);
    const C = w.folder("C", 6);
    w.show(A);
    w.c.pass(1_000);
    w.hide(A);
    w.show(B);
    w.c.pass(5_000);
    w.hide(B);
    w.show(C);
    w.c.pass(SWAP_AFTER_MS - 1);
    w.hide(C);
    w.show(B);
    w.c.pass(SWAP_AFTER_MS * 5);
    await handOn();
    expect([w.modes(A), w.modes(B), w.modes(C)]).toEqual([six("webgl"), six("webgl"), six("dom")]);
    expect([w.pool.live, w.counts()]).toEqual([12, { makes: 12, disposes: 0 }]);
    for (const p of [...A, ...B, ...C]) p.park.stop();
  });

  test("the swap never takes a slot from a shown pane: with every slot on screen the extra pane stays plain", async () => {
    const w = world(2);
    const [p, q, r] = w.folder("P", 3);
    w.show([p, q, r]);
    expect(w.modes([p, q, r])).toEqual(["webgl", "webgl", "dom"]);
    w.c.pass(SWAP_AFTER_MS * 5);
    await handOn();
    expect([w.modes([p, q, r]), r.choice.waiting, w.counts()]).toEqual([["webgl", "webgl", "dom"], true, { makes: 2, disposes: 0 }]);
    for (const t of [p, q, r]) t.park.stop();
  });

  test("a stopped or hidden-again pane's swap does nothing", async () => {
    const w = world(1);
    const [p, q, s] = w.folder("P", 3);
    w.show([p]);
    w.c.pass(1_000);
    w.hide([p]);
    w.show([q]); // pool full of p (hidden 0 s): q waits
    w.show([s]); // s waits as well
    w.c.pass(SWAP_AFTER_MS - 1);
    w.hide([q]); // gone before its swap
    s.park.stop(); // unmounted before its swap
    s.choice.dispose();
    w.c.pass(SWAP_AFTER_MS * 5);
    await handOn();
    expect([w.modes([p, q, s]), w.counts()]).toEqual([["webgl", "dom", "dom"], { makes: 1, disposes: 0 }]);
    for (const t of [p, q]) t.park.stop();
  });

  test("20 panes, 12 slots, folders of 6/6/6/2: each switch moves only the slots it needs, from the panes hidden longest", async () => {
    const w = world(12, 600_000); // no pane parks on its own here: every release is a swap
    const F = [w.folder("A", 6), w.folder("B", 6), w.folder("C", 6), w.folder("D", 2)];
    const hiddenAt = new Map<Pane, number>();
    let current: Pane[] = [];
    let step = 0;
    for (const f of [0, 1, 2, 0, 3, 1, 2, 0, 1, 3, 0]) {
      step++;
      const next = F[f];
      const holdsBefore = new Set(w.all.filter((p) => p.choice.mode === "webgl"));
      const liveBefore = w.pool.live;
      const before = w.counts();
      for (const p of current) hiddenAt.set(p, step);
      w.hide(current);
      w.show(next);
      for (const p of next) hiddenAt.delete(p);
      w.c.pass(SWAP_AFTER_MS);
      await handOn();
      const after = w.counts();
      const need = next.filter((p) => !holdsBefore.has(p)).length;
      const label = `step ${step} (folder ${f})`;
      expect(w.modes(next), label).toEqual(next.map(() => "webgl"));
      expect(after.makes - before.makes, label).toBe(need);
      expect(after.disposes - before.disposes, label).toBe(Math.max(0, liveBefore + need - 12));
      expect(w.pool.live, label).toBeLessThanOrEqual(12);
      const evicted = [...holdsBefore].filter((p) => p.choice.mode === "dom");
      const stillHeld = w.all.filter((p) => !next.includes(p) && p.choice.mode === "webgl");
      for (const e of evicted) {
        expect(next.includes(e), `${label}: ${e.name} is on screen`).toBe(false);
        for (const k of stillHeld) expect(hiddenAt.get(e)! <= hiddenAt.get(k)!, `${label}: ${e.name} lost before ${k.name}`).toBe(true);
      }
      current = next;
    }
    expect(w.counts()).toEqual({ makes: 54, disposes: 42 }); // 11 switches; a no-churn policy can do no better
    for (const p of w.all) p.park.stop();
  });
});
