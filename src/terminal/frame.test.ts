// T-765: the pane's batching logic. Before this, every output event wrote straight to xterm, so
// 200 chunks in one frame were 200 writes and 200 parse jobs; the first case here is exactly that
// stream and expects one write. Driven by a hand clock and scheduler, so a frame is a frame.
import { expect, test } from "vitest";
import { FRAME_BYTES, FRAME_MS, HIDDEN_BYTES, HIDDEN_MS, frameBudget, frameOutputs, type FrameSink } from "./frame";

const enc = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** A clock and a scheduler driven by hand. */
function manual() {
  let t = 0;
  let id = 0;
  const frames: (() => void)[] = [];
  const timers: { id: number; at: number; fn: () => void }[] = [];
  return {
    clock: () => t,
    scheduler: {
      frame(fn: () => void) {
        frames.push(fn);
        return () => {
          const i = frames.indexOf(fn);
          if (i >= 0) frames.splice(i, 1);
        };
      },
      later(fn: () => void, ms: number) {
        const k = ++id;
        timers.push({ id: k, at: t + ms, fn });
        return () => {
          const i = timers.findIndex((x) => x.id === k);
          if (i >= 0) timers.splice(i, 1);
        };
      },
    },
    /** One animation frame: the clock moves on, then the callbacks that were queued for it run. */
    frame() {
      t += FRAME_MS;
      for (const fn of frames.splice(0)) fn();
    },
    advance(ms: number) {
      t += ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
    },
    queued: () => frames.length,
    timers: () => timers.length,
  };
}

/** A pane sink that records writes and acks; `hold` keeps each callback until released. */
function sink(opts: { hidden?: () => boolean; hold?: boolean } = {}) {
  const writes: Uint8Array[] = [];
  const acks: number[] = [];
  const held: (() => void)[] = [];
  const frameSink: FrameSink = {
    write(bytes, done) {
      writes.push(bytes);
      if (opts.hold) held.push(done);
      else done();
    },
    ack(n) {
      acks.push(n);
    },
    hidden: opts.hidden ?? (() => false),
  };
  return {
    frameSink,
    writes,
    acked: () => acks.reduce((a, b) => a + b, 0),
    held: () => held.length,
    release() {
      for (const done of held.splice(0)) done();
    },
    all: () => writes.reduce((n, b) => n + b.length, 0),
    joined: () => {
      const all = new Uint8Array(writes.reduce((n, b) => n + b.length, 0));
      let at = 0;
      for (const b of writes) {
        all.set(b, at);
        at += b.length;
      }
      return text(all);
    },
  };
}

test("T-765: 200 chunks that arrive in one frame are one xterm write, whole and in order", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const s = sink();
  const pane = out.pane(s.frameSink);
  let want = "";
  let settled = 0;
  for (let i = 0; i < 200; i++) {
    want += `${i}\n`;
    settled += i + 2;
    pane.push(enc(`${i}\n`), i + 2);
  }
  expect(s.writes).toHaveLength(0); // nothing is drawn per chunk
  c.frame();
  expect(s.writes).toHaveLength(1); // the frame's one write
  expect(s.joined()).toBe(want);
  expect(s.acked()).toBe(settled);
});

test("T-765: one write in flight per pane; the next waits for xterm's callback (the reader's flow control)", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const s = sink({ hold: true });
  const pane = out.pane(s.frameSink);
  pane.push(enc("a"), 1);
  c.frame();
  expect(s.joined()).toBe("a");
  pane.push(enc("b"), 1);
  for (let i = 0; i < 3; i++) c.frame();
  expect(s.joined()).toBe("a"); // b does not run ahead of a
  expect(s.held()).toBe(1);
  s.release();
  c.frame();
  expect(s.joined()).toBe("ab");
  s.release(); // b's own callback
  expect(s.acked()).toBe(2);
});

test("T-765: six panes flooding share the frame's bytes, every pane gets served in order and nothing is lost", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const panes = Array.from({ length: 6 }, () => sink());
  const queues = panes.map((s) => out.pane(s.frameSink));
  const want = panes.map((_, p) => Array.from({ length: 12 }, (_, i) => `${p}:${String(i).padStart(4, "0")} ${"x".repeat(20 * 1024)}\n`).join(""));
  queues.forEach((q, p) => {
    for (let i = 0; i < 12; i++) q.push(enc(`${p}:${String(i).padStart(4, "0")} ${"x".repeat(20 * 1024)}\n`), 20 * 1024 + 6);
  });
  let frames = 0;
  let biggest = 0;
  while (panes.some((s, p) => s.all() < want[p].length)) {
    const before = panes.map((s) => s.all());
    c.frame();
    frames++;
    const wrote = panes.reduce((n, s, p) => n + (s.all() - before[p]), 0);
    biggest = Math.max(biggest, wrote);
    expect(wrote).toBeLessThanOrEqual(FRAME_BYTES);
    if (frames > 40) break;
  }
  expect(frames).toBeLessThanOrEqual(40);
  expect(biggest).toBeGreaterThan(0);
  panes.forEach((s, p) => {
    expect(s.all()).toBe(enc(want[p]).length);
    expect(s.joined()).toBe(want[p]);
    expect(s.acked()).toBe(12 * (20 * 1024 + 6));
  });
});

test("T-765: a pane on a hidden tab draws a trickle and takes nothing from the visible tab's frame", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  let away = true;
  const hidden = sink({ hidden: () => away });
  const shown = sink();
  const hiddenPane = out.pane(hidden.frameSink);
  const shownPane = out.pane(shown.frameSink);
  hiddenPane.push(new Uint8Array(100 * 1024), 100 * 1024);
  expect(c.timers()).toBe(1); // off screen: a timer, not an animation frame
  c.advance(HIDDEN_MS);
  expect(hidden.all()).toBe(HIDDEN_BYTES); // one small step, not the whole 100 KB
  expect(hiddenPane.pending).toBe(100 * 1024 - HIDDEN_BYTES);
  shownPane.push(new Uint8Array(100 * 1024), 100 * 1024);
  c.frame();
  expect(shown.all()).toBe(100 * 1024); // the whole frame's budget, because the hidden pane is not on screen
  away = false;
  hiddenPane.wake();
  c.frame();
  expect(hidden.all()).toBe(100 * 1024); // shown again, it catches up in one frame
  expect(hiddenPane.pending).toBe(0);
});

test("T-765: flushNow puts waiting output before a direct write; clear drops what a snapshot holds and still acks it", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const log: string[] = [];
  const acks: number[] = [];
  const pane = out.pane({
    write: (bytes, done) => {
      log.push(text(bytes));
      done();
    },
    ack: (n) => acks.push(n),
    hidden: () => false,
  });
  pane.push(enc("live"), 4);
  pane.flushNow(); // what a pane does before its exit note or a reset
  log.push("note");
  expect(log).toEqual(["live", "note"]);
  expect(acks).toEqual([4]);
  pane.push(enc("old"), 9);
  pane.clear(); // a snapshot already holds it
  expect(log).toEqual(["live", "note"]);
  expect(acks).toEqual([4, 9]);
  expect(pane.pending).toBe(0);
});

test("T-765: a snapshot only drops the chunks it holds; newer output and chunks without a count still draw", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const writes: string[] = [];
  const acks: number[] = [];
  const pane = out.pane({
    write: (bytes, done) => {
      writes.push(text(bytes));
      done();
    },
    ack: (n) => acks.push(n),
    hidden: () => false,
  });
  pane.push(enc("old"), 3, 4);
  pane.push(enc("new"), 5, 6);
  pane.push(enc("plain"), 7); // an older service's chunk carries no count and always draws
  pane.dropUpTo(4); // the snapshot holds everything up to seq 4
  expect(acks).toEqual([3]);
  c.frame();
  expect(writes.join("")).toBe("newplain");
  expect(acks).toEqual([3, 12]);
  expect(pane.pending).toBe(0);
});

test("T-765: dispose cancels the frame it queued and settles what it held", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const s = sink();
  const pane = out.pane(s.frameSink);
  pane.push(enc("x"), 3);
  expect(c.queued()).toBe(1);
  pane.dispose();
  expect(c.queued()).toBe(0);
  expect(s.writes).toHaveLength(0);
  expect(s.acked()).toBe(3);
  pane.push(enc("y"), 5); // a disposed pane draws nothing and still settles the reader
  expect(s.acked()).toBe(8);
});

test("T-765: the frame allowance refills at the frame's rate and never banks a long gap", () => {
  let t = 0;
  const b = frameBudget(100, 10, () => t); // 10 bytes a millisecond, 100 a frame
  expect(b.take(60)).toBe(60);
  expect(b.take(60)).toBe(40); // the frame is spent
  t = 5;
  expect(b.take(60)).toBe(50); // half a frame later, half a frame's bytes
  t = 10;
  expect(b.take(60)).toBe(50);
  expect(b.take(60)).toBe(0);
  t = 1010; // hidden for a second: one frame's allowance, not a hundred
  expect(b.take(1000)).toBe(100);
  expect(b.share(6)).toBe(16);
  expect(b.share(0)).toBe(100);
});
