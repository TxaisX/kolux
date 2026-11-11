// T-765: with six panes flooding, every output chunk became its own xterm write and its own parse
// job, so the window stopped answering for about a second. Output is collected here per pane and
// handed to xterm once a frame at most: one write in flight per pane (its callback is the flow
// control the reader's unacked window sits on, ACCT-054), and a byte budget shared by the panes on
// screen so a flood cannot take the frame from drawing and from the user. Order is kept and no byte
// is dropped; a pane that is off screen draws a small trickle, enough to keep its acknowledgements
// flowing and little enough that a background flood never competes with the visible tab.
//
// DT-C236: since the engine is told when the window is minimised or in the tray, `document.hidden`
// turns true then and no animation frame comes. The shown pane of such a window is not "off screen"
// in the trickle's sense (nothing competes with it and nothing is painted), so it keeps its full
// share, stepped by a timer at the frame's rate instead of by the frame; a program running ahead
// is not slowed to the trickle for the time the window sits minimised. The panes behind other tabs
// trickle as before. A visibility change re-plans every waiting pane, so one that waited on an
// animation frame when the window went away moves to the timer at once.
//
// The budget is measured, not guessed: xterm parses about 19 MB/s on this thread (the second case in
// outputFlood.test.ts), so 128 KB is ~7 ms of a 16.7 ms frame, and a pane gets its share of that.
// What the queue does not do is decide what is drawn: the reader's own window (512 KB unacked) is
// what stops a program that runs ahead, so a slow frame delays output instead of losing it.
//
// PKG-3 (typing): a key's echo is one small chunk for a pane that had nothing to draw, and waiting for
// the next frame to hand it over cost up to a frame before xterm (which parses the first write after a
// key at once) could even start. So a quiet pane on screen writes its first small chunk as it arrives,
// through the same write and the same callback (the acknowledgement, the one write in flight), and
// counted against the frame's allowance. Only the first: the pane is busy from that chunk on, and
// quiet again only after a whole frame in which nothing arrived and nothing was left to draw, so a
// flood still goes one write a frame and costs at most one early write when it starts.

import { heldBytes } from "./codec";

export type FrameSink = {
  /** Hand these bytes to xterm; call `done` once it has parsed them. */
  write(bytes: Uint8Array, done: () => void): void;
  /** `bytes` of the reader's output are settled: drawn, or already held by a snapshot. */
  ack(bytes: number): void;
  /** This pane is not on screen: it sits behind another tab. */
  hidden(): boolean;
  /** The whole window is out of sight (minimised, in the tray): no frame comes, nothing is painted. */
  unseen?(): boolean;
};

export type FrameOutput = {
  /** One output chunk, in arrival order. `ack` is how much of the reader's output it settles. */
  push(bytes: Uint8Array, ack?: number, seq?: number): void;
  /** Draw what is waiting now, before a direct write that must follow it (an exit note, a reset). */
  flushNow(): void;
  /** Drop what a snapshot up to `seq` already holds (chunks without a count always draw); still acknowledged. */
  dropUpTo(seq: number): void;
  /** Drop everything waiting; still acknowledged. */
  clear(): void;
  /** The pane appeared or went off screen: re-plan at once rather than on the next chunk. */
  wake(): void;
  /** Bytes waiting to be drawn. */
  readonly pending: number;
  dispose(): void;
};

export type FrameScheduler = {
  /** Run `fn` on the next animation frame; returns a cancel. */
  frame(fn: () => void): () => void;
  /** Run `fn` after `ms`; returns a cancel. */
  later(fn: () => void, ms: number): () => void;
};

/** One frame at 60 Hz. */
export const FRAME_MS = 1000 / 60;
/** Bytes all panes on screen together may hand xterm in one frame. */
export const FRAME_BYTES = 128 * 1024;
/** What an off-screen pane may hand xterm in one step. */
export const HIDDEN_BYTES = 8 * 1024;
/** How often an off-screen pane draws a step. */
export const HIDDEN_MS = 200;
/** The largest chunk a quiet pane on screen writes as it arrives (a key's echo, a prompt). */
export const FAST_BYTES = 4 * 1024;

const now = () => performance.now();

const defaultScheduler: FrameScheduler = {
  frame: (fn) => {
    if (typeof requestAnimationFrame !== "function") return defaultScheduler.later(fn, FRAME_MS);
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  },
  later: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** The frame's byte allowance: refilled at the frame's rate, never banked past one frame. */
export function frameBudget(perFrame = FRAME_BYTES, frameMs = FRAME_MS, clock: () => number = now) {
  const rate = perFrame / frameMs;
  let left = perFrame;
  let at = clock();
  return {
    /** How many of `want` bytes may go now. */
    take(want: number): number {
      const t = clock();
      const gained = (t - at) * rate;
      // A clock that went backwards starts again rather than blocking the frame.
      if (gained > 0) {
        left = Math.min(perFrame, left + gained);
        at = t;
      } else if (t < at) at = t;
      const n = Math.max(0, Math.min(want, Math.floor(left)));
      left -= n;
      return n;
    },
    /** Takes all `want` bytes if the allowance holds them, else nothing. */
    takeAll(want: number): boolean {
      this.take(0); // brings the allowance up to now
      if (left < want) return false;
      left -= want;
      return true;
    },
    /** What one of `waiting` panes may take in a frame when they all have output. */
    share(waiting: number): number {
      return Math.max(1, Math.floor(perFrame / Math.max(1, waiting)));
    },
  };
}

type Part = { bytes: Uint8Array; ack: number; seq?: number };

type Options = {
  perFrame?: number;
  frameMs?: number;
  hiddenBytes?: number;
  hiddenMs?: number;
  clock?: () => number;
  scheduler?: FrameScheduler;
  /** Called with the function to run on every visibility change (the document's event by default). */
  onVisibility?: (f: () => void) => void;
};

/** How a waiting pane is stepped. */
type Mode = "frame" | "timer" | "trickle";

const documentVisibility = (f: () => void) => {
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", f);
  }
};

/**
 * One window's output queues. Every pane shares the frame's byte allowance, so ten panes flooding
 * cost the same per frame as one; a pane with nothing waiting takes nothing.
 */
export function frameOutputs(options: Options = {}) {
  const perFrame = options.perFrame ?? FRAME_BYTES;
  const frameMs = options.frameMs ?? FRAME_MS;
  const hiddenBytes = options.hiddenBytes ?? HIDDEN_BYTES;
  const hiddenMs = options.hiddenMs ?? HIDDEN_MS;
  const scheduler = options.scheduler ?? defaultScheduler;
  const budget = frameBudget(perFrame, frameMs, options.clock ?? now);
  const waiting = new Set<Pane>();
  const onScreen = () => {
    let n = 0;
    for (const p of waiting) if (!p.offScreen()) n++;
    return n;
  };
  // DT-C236: the window went out of sight or came back; every waiting pane re-plans its next step.
  (options.onVisibility ?? documentVisibility)(() => {
    for (const p of [...waiting]) p.wake();
  });

  class Pane implements FrameOutput {
    private parts: Part[] = [];
    private bytes = 0;
    private inflight = 0;
    private cancel: (() => void) | null = null;
    private due: Mode | null = null;
    private closed = false;
    /** PKG-3: a whole frame went by with nothing arriving and nothing to draw; the next small chunk may go at once. */
    private quiet = false;
    /** A chunk arrived since the settle frame was asked for. */
    private stirred = false;
    private settling: (() => void) | null = null;

    constructor(private readonly sink: FrameSink) {}

    get pending(): number {
      return this.bytes;
    }

    offScreen(): boolean {
      return this.sink.hidden();
    }

    private mode(): Mode {
      if (this.offScreen()) return "trickle";
      return this.sink.unseen?.() ? "timer" : "frame";
    }

    push(bytes: Uint8Array, ack = bytes.length, seq?: number): void {
      if (this.closed || bytes.length === 0) {
        this.sink.ack(ack);
        return;
      }
      // A shown pane drains within a frame or two, so its chunks stay views over the batch they came in
      // (DT-C246, no copy); a hidden pane trickles and holds them for seconds, up to FLOW_HIGH bytes deep,
      // where a small view would pin its whole 192 KB batch, so those are copied.
      const off = this.offScreen();
      // PKG-3: nothing is waiting or in xterm's hands, so this chunk is next in order whichever way it goes.
      const fast =
        this.quiet && bytes.length <= FAST_BYTES && !off && this.inflight === 0 && !this.parts.length && !this.sink.unseen?.() && budget.takeAll(bytes.length);
      this.quiet = false;
      this.stirred = true;
      this.parts.push({ bytes: off ? heldBytes(bytes) : bytes, ack, seq });
      this.bytes += bytes.length;
      if (fast) {
        this.writeUpTo(bytes.length);
        return;
      }
      waiting.add(this);
      this.plan();
    }

    wake(): void {
      // A pane hidden after its chunks were queued copies them now, so the trickle does not pin their batches.
      if (this.offScreen()) for (const p of this.parts) p.bytes = heldBytes(p.bytes);
      if (this.parts.length) this.plan();
    }

    flushNow(): void {
      this.cancel?.();
      this.cancel = null;
      this.due = null;
      if (!this.parts.length) return;
      if (this.closed) {
        this.drop();
        return;
      }
      // Not held back by a write in flight: xterm's own queue keeps the order, and this only runs on
      // a pane that is ending or being redrawn from a snapshot.
      this.writeUpTo(this.bytes);
    }

    dropUpTo(seq: number): void {
      this.drop((p) => p.seq !== undefined && p.seq <= seq);
    }

    clear(): void {
      this.cancel?.();
      this.cancel = null;
      this.due = null;
      this.drop();
    }

    dispose(): void {
      this.closed = true;
      this.cancel?.();
      this.cancel = null;
      this.due = null;
      this.settling?.();
      this.settling = null;
      this.drop();
    }

    /** PKG-3: everything is drawn; a frame from now, the pane is quiet unless something came meanwhile. */
    private settleSoon(): void {
      // Off screen or out of sight nothing is drawn early, and no animation frame may come.
      if (this.settling || this.mode() !== "frame") return;
      this.stirred = false;
      this.settling = scheduler.frame(this.settle);
    }

    private readonly settle = () => {
      this.settling = null;
      if (this.closed || this.parts.length || this.inflight > 0) return; // the write that drains them asks again
      if (this.stirred) this.settleSoon();
      else this.quiet = true;
    };

    private plan(): void {
      if (this.closed || this.inflight > 0 || !this.parts.length) return;
      const mode = this.mode();
      if (this.cancel) {
        if (this.due === mode) return;
        this.cancel();
        this.cancel = null;
      }
      this.due = mode;
      const run = () => {
        this.cancel = null;
        this.due = null;
        this.tick();
      };
      this.cancel =
        mode === "trickle" ? scheduler.later(run, hiddenMs) : mode === "timer" ? scheduler.later(run, frameMs) : scheduler.frame(run);
    }

    private tick(): void {
      if (this.closed || this.inflight > 0 || !this.parts.length) return;
      if (this.offScreen()) {
        this.writeUpTo(Math.min(this.bytes, hiddenBytes));
        return;
      }
      const share = budget.share(onScreen());
      const n = budget.take(Math.min(this.bytes, share));
      // The frame's allowance is spent; the next frame gets it (a write in flight plans the next one).
      if (n === 0) this.plan();
      else this.writeUpTo(n);
    }

    private take(n: number): Part {
      const first = this.parts[0];
      if (first.bytes.length <= n) {
        this.parts.shift();
        this.bytes -= first.bytes.length;
        return first;
      }
      // Split a chunk only at a byte boundary: xterm reassembles a multi-byte character across writes.
      const head = { bytes: first.bytes.subarray(0, n), ack: first.ack };
      first.bytes = first.bytes.subarray(n);
      first.ack = 0;
      this.bytes -= n;
      return head;
    }

    private writeUpTo(n: number): void {
      const out: Uint8Array[] = [];
      let ack = 0;
      let total = 0;
      while (total < n && this.parts.length) {
        const want = Math.min(n - total, this.parts[0].bytes.length);
        if (want <= 0) break;
        const p = this.take(want);
        out.push(p.bytes);
        ack += p.ack;
        total += p.bytes.length;
      }
      if (!this.parts.length) waiting.delete(this);
      else waiting.add(this);
      const bytes =
        out.length === 1
          ? out[0]
          : (() => {
              const all = new Uint8Array(total);
              let at = 0;
              for (const b of out) {
                all.set(b, at);
                at += b.length;
              }
              return all;
            })();
      this.inflight++;
      const done = () => {
        this.inflight--;
        this.sink.ack(ack);
        if (this.closed) this.drop();
        else if (this.parts.length) this.plan();
        else if (this.inflight === 0) this.settleSoon();
      };
      try {
        this.sink.write(bytes, done);
      } catch {
        // The terminal is gone; settle the reader's count instead of holding its window forever.
        this.inflight--;
        this.sink.ack(ack);
        this.drop();
      }
    }

    private drop(gone: (p: Part) => boolean = () => true): void {
      if (!this.parts.length) {
        waiting.delete(this);
        return;
      }
      let ack = 0;
      const keep: Part[] = [];
      for (const p of this.parts) {
        if (gone(p)) ack += p.ack;
        else keep.push(p);
      }
      if (keep.length === this.parts.length) return; // a snapshot held nothing that is waiting
      this.parts = keep;
      this.bytes = keep.reduce((n, p) => n + p.bytes.length, 0);
      if (keep.length) waiting.add(this);
      else waiting.delete(this);
      this.sink.ack(ack);
    }
  }

  return {
    /** A pane's queue; `sink.hidden()` is read at every step, so a tab switch needs no re-registration. */
    pane(sink: FrameSink): FrameOutput {
      return new Pane(sink);
    },
  };
}
