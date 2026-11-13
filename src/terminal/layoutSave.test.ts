import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedLayout } from "./layout";
import { layoutWriter } from "./layoutSave";

const layout = (focused: number): SavedLayout => ({ panes: [{ key: 1, cwd: "C:\\w\\a", branch: null, agent: "shell", program: null, args: [] }, { key: 2, cwd: "C:\\w\\a", branch: null, agent: "shell", program: null, args: [], kind: "editor", path: "C:\\w\\a\\README.md" }], focused, activeDir: "C:\\w\\a", stacked: {} });

describe("T-075 (APP-048): the layout writer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns a burst of changes into one write of the newest layout, after the quiet time", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    w.set(layout(1));
    vi.advanceTimersByTime(300);
    w.set(layout(2));
    vi.advanceTimersByTime(300);
    expect(writes).toEqual([]); // the second change restarted the quiet time
    expect(w.pending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(writes.map((l) => l.focused)).toEqual([2]);
    expect(w.pending()).toBe(false);
  });

  it("S5: constant churn (a change every 40 ms for 5 s) still saves at least every 2 s, then once more after the churn stops", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    for (let t = 0; t < 5000; t += 40) {
      w.set(layout(t / 40 + 1));
      vi.advanceTimersByTime(40);
    }
    expect(writes.length).toBeGreaterThanOrEqual(2); // before the churn stops
    expect(writes.length).toBe(2); // at 2 s and 4 s
    const seen = writes.length;
    expect(w.pending()).toBe(true);
    vi.advanceTimersByTime(400);
    expect(writes.length).toBe(seen + 1); // the trailing save
    expect(writes[writes.length - 1].focused).toBe(5000 / 40);
    expect(w.pending()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(writes.length).toBe(seen + 1); // nothing left armed
  });

  it("a flush resets the maximum wait, and the maximum wait is configurable", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400, { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) }, 1000);
    for (const n of [1, 2, 3]) { // churn under the quiet time, 0..600 ms
      w.set(layout(n));
      vi.advanceTimersByTime(300);
    }
    w.flush(); // at 900 ms, before the 1000 ms wait ran out
    expect(writes.map((l) => l.focused)).toEqual([3]);
    for (const n of [4, 5, 6]) {
      w.set(layout(n));
      vi.advanceTimersByTime(300);
    } // 1800 ms: the first wait would have fired at 1000 ms
    expect(writes.length).toBe(1);
    vi.advanceTimersByTime(100); // 1900 ms = 1000 ms after the first change since the flush
    expect(writes.map((l) => l.focused)).toEqual([3, 6]);
  });

  it("flush writes what is pending at once (the quit path) and is a no-op with nothing pending", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    w.flush();
    expect(writes).toEqual([]);
    w.set(layout(1));
    w.flush();
    expect(writes.map((l) => l.focused)).toEqual([1]);
    vi.advanceTimersByTime(1000);
    expect(writes.length).toBe(1); // the timer was cleared by the flush
  });

  it("does not write a layout equal to the last one written", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    w.set(layout(1));
    vi.advanceTimersByTime(400);
    w.set(layout(1));
    vi.advanceTimersByTime(400);
    expect(writes.length).toBe(1);
    w.set(layout(3));
    w.flush();
    expect(writes.length).toBe(2);
  });

  it("keeps the editor tab of a worktree in what it writes (T-093-a)", () => {
    const writes: SavedLayout[] = [];
    const w = layoutWriter((l) => writes.push(l), 400);
    w.set(layout(2));
    w.flush();
    expect(writes[0].panes[1]).toMatchObject({ kind: "editor", path: "C:\\w\\a\\README.md", cwd: "C:\\w\\a" });
  });

  it("after-list #37/#39: a failed write stays pending and goes again; flush settles once the write lands", async () => {
    const tried: number[] = [];
    let fail = true;
    const w = layoutWriter((l) => {
      tried.push(l.focused);
      return fail ? Promise.reject(new Error("disk full")) : Promise.resolve();
    }, 400);
    w.set(layout(3));
    await w.flush();
    expect(tried).toEqual([3]);
    expect(w.pending()).toBe(true); // the failed layout is not counted as written
    fail = false;
    let landed = false;
    const done = w.flush().then(() => (landed = true));
    expect(tried).toEqual([3, 3]); // the same layout is written again, not skipped as "already written"
    await done;
    expect(landed).toBe(true);
    expect(w.pending()).toBe(false);
    await w.flush();
    expect(tried).toEqual([3, 3]);
  });
});
