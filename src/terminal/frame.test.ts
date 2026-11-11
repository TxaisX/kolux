// T-765: the pane's batching logic. Before this, every output event wrote straight to xterm, so
// 200 chunks in one frame were 200 writes and 200 parse jobs; the first case here is exactly that
// stream and expects one write. Driven by a hand clock and scheduler, so a frame is a frame.
import { expect, test } from "vitest";
import { FAST_BYTES, FRAME_BYTES, FRAME_MS, HIDDEN_BYTES, HIDDEN_MS, frameBudget, frameOutputs, type FrameSink } from "./frame";

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
function sink(opts: { hidden?: () => boolean; unseen?: () => boolean; hold?: boolean } = {}) {
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
    unseen: opts.unseen,
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

test("DT-C236: the shown pane of a minimised window keeps its full share by timer, with no frame to wait for", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler, onVisibility: () => {} });
  let away = true;
  const s = sink({ unseen: () => away });
  const pane = out.pane(s.frameSink);
  const burst = 5 * FRAME_BYTES;
  pane.push(new Uint8Array(burst), burst);
  expect(c.queued()).toBe(0); // no animation frame: none would come
  expect(c.timers()).toBe(1);
  c.advance(FRAME_MS);
  expect(s.all()).toBe(FRAME_BYTES); // a whole frame's bytes a step, not the hidden tab's trickle
  for (let i = 0; i < 4; i++) c.advance(FRAME_MS);
  expect(s.all()).toBeGreaterThanOrEqual(burst - 5); // 5 frames' worth in 5 frame times (the budget's rounding keeps a byte or so back)
  c.advance(FRAME_MS);
  expect(s.all()).toBe(burst);
  expect(pane.pending).toBe(0);
  // Behind another tab in that window: the trickle, as before.
  const hidden = sink({ hidden: () => true, unseen: () => away });
  const back = out.pane(hidden.frameSink);
  back.push(new Uint8Array(100 * 1024), 100 * 1024);
  c.advance(HIDDEN_MS);
  expect(hidden.all()).toBe(HIDDEN_BYTES);
  away = false;
  pane.push(new Uint8Array(10), 10);
  expect(c.queued()).toBe(1); // back in sight: the animation frame again
});

test("DT-C236: a visibility change re-plans a pane that waited on a frame the hidden window never gives", () => {
  const c = manual();
  let visibility: (() => void) | null = null;
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler, onVisibility: (f) => (visibility = f) });
  let away = false;
  const s = sink({ unseen: () => away });
  const pane = out.pane(s.frameSink);
  pane.push(new Uint8Array(1000), 1000);
  expect(c.queued()).toBe(1);
  away = true; // the window is minimised: the queued frame would never run
  visibility!();
  expect(c.queued()).toBe(0);
  expect(c.timers()).toBe(1);
  c.advance(FRAME_MS);
  expect(s.all()).toBe(1000);
  pane.push(new Uint8Array(500), 500);
  expect(c.timers()).toBe(1);
  away = false; // restored before the timer fired: the frame takes over
  visibility!();
  expect(c.timers()).toBe(0);
  expect(c.queued()).toBe(1);
  c.frame();
  expect(s.all()).toBe(1500);
  expect(pane.pending).toBe(0);
});

test("DT-C246 review: a chunk waiting in a hidden pane's queue does not pin the frame it was a view over", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const s = sink({ hidden: () => true });
  const q = out.pane(s.frameSink);
  const batch = new Uint8Array(64 * 1024); // one frame from the window process, many panes' chunks in it
  batch.set(enc("hidden pane"), 1000);
  q.push(batch.subarray(1000, 1011), 11, 1);
  q.flushNow();
  expect(s.writes).toHaveLength(1);
  expect(text(s.writes[0])).toBe("hidden pane");
  expect(s.writes[0].buffer).not.toBe(batch.buffer);
  // a chunk that is most of its buffer is kept as is: nothing to gain from a copy
  const own = enc("whole chunk");
  q.push(own, own.length, 2);
  q.flushNow();
  expect(s.writes[1].buffer).toBe(own.buffer);
  // a shown pane draws the chunk within a frame: its view is kept, no copy per chunk of a flood
  const shown = sink();
  const v = out.pane(shown.frameSink);
  v.push(batch.subarray(1000, 1011), 11, 3);
  v.flushNow();
  expect(shown.writes[0].buffer).toBe(batch.buffer);
});

/** A pane that has drawn and then sat a whole frame with nothing arriving: quiet. */
function quietPane(c: ReturnType<typeof manual>, out: ReturnType<typeof frameOutputs>, s: ReturnType<typeof sink>) {
  const pane = out.pane(s.frameSink);
  pane.push(enc("$ "), 2);
  c.frame(); // drawn
  if (s.held()) s.release();
  c.frame(); // a frame with nothing new: quiet from here
  s.writes.length = 0;
  return pane;
}

test("PKG-3: a quiet pane's first small chunk (a key's echo) reaches xterm with no frame wait; the rest of the frame is one write", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const s = sink();
  const pane = quietPane(c, out, s);
  const before = s.acked();
  let want = "";
  let settled = 0;
  for (let i = 0; i < 200; i++) {
    want += `${i}\n`;
    settled += i + 2;
    pane.push(enc(`${i}\n`), i + 2);
    if (i === 0) expect(s.writes.map(text)).toEqual(["0\n"]); // at once, before any frame
  }
  expect(s.writes).toHaveLength(1); // only the first: the pane is busy now and the rest wait for the frame
  c.frame();
  expect(s.writes).toHaveLength(2); // the frame's one write
  expect(s.joined()).toBe(want);
  expect(s.acked() - before).toBe(settled);
});

test("PKG-3: early and queued chunks reach xterm in arrival order, one write in flight, acked on xterm's callback", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const s = sink({ hold: true });
  const pane = quietPane(c, out, s);
  const base = s.acked();
  pane.push(enc("a"), 1); // early: written now, held by xterm
  expect(s.joined()).toBe("a");
  expect(s.acked() - base).toBe(0); // not acknowledged before xterm's callback
  const burst = "B".repeat(10 * 1024); // over the early size
  pane.push(enc(burst), burst.length); // waits behind a
  c.frame();
  expect(s.joined()).toBe("a");
  s.release();
  expect(s.acked() - base).toBe(1);
  c.frame();
  expect(s.joined()).toBe("a" + burst); // the burst, in flight now
  pane.push(enc("c"), 1); // small, but not early: the burst is in xterm's hands and the pane is busy
  c.frame();
  expect(s.joined()).toBe("a" + burst);
  s.release();
  c.frame();
  expect(s.joined()).toBe("a" + burst + "c");
  s.release();
  expect(s.acked() - base).toBe(2 + burst.length);
  // A chunk that arrives before a whole frame has passed since the last draw waits for the frame.
  pane.push(enc("d"), 1);
  expect(s.joined()).toBe("a" + burst + "c");
  c.frame();
  expect(s.joined()).toBe("a" + burst + "cd");
  pane.push(enc("e"), 1); // d is in flight
  s.release();
  c.frame();
  expect(s.joined()).toBe("a" + burst + "cde");
  s.release();
  c.frame(); // the whole frame after the last draw, nothing new: quiet
  pane.push(enc("f"), 1);
  expect(s.joined()).toBe("a" + burst + "cdef"); // early again
  s.release();
  expect(s.acked() - base).toBe(5 + burst.length);
});

test("PKG-3: panes flooding cost one write a frame each, plus at most one early write per pane when the flood starts", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const panes = Array.from({ length: 6 }, () => sink());
  const queues = panes.map((s) => quietPane(c, out, s));
  const want = panes.map(() => "");
  let frames = 0;
  for (let f = 0; f < 30; f++) {
    queues.forEach((q, p) => {
      for (let i = 0; i < 20; i++) {
        const line = `${p}:${f}:${i}\n`;
        want[p] += line;
        q.push(enc(line), line.length);
      }
    });
    c.frame();
    frames++;
  }
  c.frame();
  panes.forEach((s, p) => {
    expect(s.joined()).toBe(want[p]);
    expect(s.writes.length).toBeLessThanOrEqual(frames + 1); // today's one a frame, plus the first chunk early
  });
});

test("PKG-3: nothing goes early for a pane behind another tab, in a window out of sight, or when the frame's allowance is spent", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler, onVisibility: () => {} });
  let away = false;
  let behind = false;
  const s = sink({ hidden: () => behind, unseen: () => away });
  const pane = quietPane(c, out, s);
  behind = true;
  pane.push(enc("x"), 1);
  expect(s.writes).toHaveLength(0); // the hidden tab's trickle
  c.advance(HIDDEN_MS);
  expect(s.joined()).toBe("x");
  behind = false;
  c.frame();
  c.frame();
  away = true;
  pane.push(enc("y"), 1);
  expect(s.joined()).toBe("x"); // minimised: the timer step, nothing painted anyway
  c.advance(FRAME_MS);
  expect(s.joined()).toBe("xy");
  away = false;
  // Another pane takes the whole frame; this pane's small chunk then waits for the next frame.
  const flood = sink();
  const big = out.pane(flood.frameSink);
  c.frame();
  pane.push(enc("q"), 1);
  pane.push(enc("r"), 1);
  c.frame();
  c.frame();
  c.frame(); // drawn, and a quiet frame after it
  big.push(new Uint8Array(FRAME_BYTES), FRAME_BYTES);
  c.frame();
  expect(flood.all()).toBe(FRAME_BYTES);
  pane.push(enc("z"), 1);
  expect(s.joined()).toBe("xyqr"); // no allowance left in this frame
  c.frame();
  expect(s.joined()).toBe("xyqrz");
});

test("PKG-3: a chunk over the early size waits for the frame as before", () => {
  const c = manual();
  const out = frameOutputs({ clock: c.clock, scheduler: c.scheduler });
  const s = sink();
  const pane = quietPane(c, out, s);
  pane.push(new Uint8Array(FAST_BYTES + 1), FAST_BYTES + 1);
  expect(s.writes).toHaveLength(0);
  c.frame();
  expect(s.all()).toBe(FAST_BYTES + 1);
});
