// USAGE-023 (T-070): the usage refresh scheduler, decided as pure functions of time and the last
// result, and the runner that drives one provider's reads from them. Fake clocks throughout.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKOFF_MS, EVERY_MS, MOMENTS_MS, backoffMs, began, claudeFetched, codexFetched, ended, fresh, published, refreshAll, runner, shouldFetch, type Fetched, type Sched } from "./refresh";

const MIN = 60_000;
const t0 = 1_000_000;

describe("shouldFetch", () => {
  it("runs the five-minute timer, skips a focus moments after a read and fetches once on a focus six minutes later", () => {
    expect(EVERY_MS).toBe(5 * MIN);
    let s: Sched = fresh();
    expect(shouldFetch(s, "start", t0)).toBe(true);
    s = ended(began(s, t0), true, t0 + 400);
    expect(shouldFetch(s, "timer", t0 + EVERY_MS)).toBe(true);
    expect(shouldFetch(s, "focus", t0 + 2_000)).toBe(false); // moments ago
    expect(shouldFetch(s, "focus", t0 + MOMENTS_MS - 1)).toBe(false);
    expect(shouldFetch(s, "focus", t0 + 6 * MIN)).toBe(true);
    s = ended(began(s, t0 + 6 * MIN), true, t0 + 6 * MIN + 300);
    expect(shouldFetch(s, "focus", t0 + 6 * MIN + 2_000)).toBe(false); // a second focus 2 s later
    expect(shouldFetch(s, "start", t0 + 7 * MIN)).toBe(false); // start fetches only once
  });

  it("the first focus after a delayed start fetches once", () => {
    const s = fresh();
    expect(shouldFetch(s, "focus", t0 + 90 * MIN)).toBe(true);
    const after = ended(began(s, t0 + 90 * MIN), true, t0 + 90 * MIN + 200);
    expect(shouldFetch(after, "focus", t0 + 90 * MIN + 1_000)).toBe(false);
  });

  it("a failed start-up fetch is retried on later focuses, backing off while it keeps failing", () => {
    expect(BACKOFF_MS).toEqual([30_000, 60_000, 120_000, 300_000]);
    let s = ended(began(fresh(), t0), false, t0 + 100);
    expect(s.failures).toBe(1);
    expect(shouldFetch(s, "focus", t0 + 10_000)).toBe(false);
    expect(shouldFetch(s, "focus", t0 + 31_000)).toBe(true);
    s = ended(began(s, t0 + 31_000), false, t0 + 31_100);
    expect(backoffMs(s.failures)).toBe(60_000);
    expect(shouldFetch(s, "focus", t0 + 41_000)).toBe(false);
    expect(shouldFetch(s, "focus", t0 + 95_000)).toBe(true);
    s = ended(began(s, t0 + 95_000), false, t0 + 95_100);
    expect(backoffMs(s.failures)).toBe(120_000);
    s = ended(began(s, t0 + 300_000), false, t0 + 300_100);
    expect(backoffMs(s.failures)).toBe(300_000);
    s = ended(began(s, t0 + 700_000), false, t0 + 700_100);
    expect(backoffMs(s.failures)).toBe(300_000); // the cap: never gated longer than the timer period
    // the background timer keeps trying regardless of the focus backoff
    expect(shouldFetch(s, "timer", t0 + 700_000 + EVERY_MS)).toBe(true);
    // one success clears it all
    s = ended(began(s, t0 + 1_200_000), true, t0 + 1_200_200);
    expect(s).toMatchObject({ failures: 0, retryAfter: null, lastOk: t0 + 1_200_200 });
  });

  it("a manual refresh ignores the debounce and the provider's retry-after; the timer and a focus honour retry-after", () => {
    let s = ended(began(fresh(), t0), true, t0 + 100);
    expect(shouldFetch(s, "manual", t0 + 1_000)).toBe(true); // inside the debounce
    s = ended(began(s, t0 + 1_000), false, t0 + 1_100, 10 * MIN);
    expect(s.retryAfter).toBe(t0 + 1_100 + 10 * MIN);
    expect(shouldFetch(s, "focus", t0 + 2 * MIN)).toBe(false);
    expect(shouldFetch(s, "timer", t0 + EVERY_MS + 1_000)).toBe(false);
    expect(shouldFetch(s, "manual", t0 + 2 * MIN)).toBe(true);
    expect(shouldFetch(s, "timer", t0 + 1_100 + 10 * MIN)).toBe(true);
    // nothing starts a second read while one is in flight, not even a manual one
    expect(shouldFetch(began(s, t0 + 2 * MIN), "manual", t0 + 2 * MIN + 10)).toBe(false);
  });
});

describe("runner", () => {
  beforeEach(() => vi.useFakeTimers({ now: t0 }));
  afterEach(() => vi.useRealTimers());

  type Stub = { calls: number; next: () => Fetched<number> | Promise<Fetched<number>> };
  const stub = (next: Stub["next"]): Stub => ({ calls: 0, next });
  const make = (st: Stub, name = "a") => {
    const oks: number[] = [];
    const fails: string[] = [];
    const seen: Array<{ failing: boolean; inFlight: boolean }> = [];
    const r = runner<number>({
      name,
      fetch: () => {
        st.calls += 1;
        return Promise.resolve(st.next());
      },
      onOk: (v) => oks.push(v),
      onFail: (m) => fails.push(m),
      onChange: (s) => seen.push({ failing: s.failures > 0, inFlight: s.inFlight }),
    });
    return { r, oks, fails, seen };
  };

  // FIX-2 (council P6): a hidden window makes no background reads, and showing it reads at once; a
  // provider with a longer focus debounce (Codex) is not re-read by a focus a minute after a read.
  it("skips timer reads while hidden, reads when shown, and keeps a longer focus debounce", async () => {
    const make2 = (debounce?: number) => {
      const fl = new Map<string, () => void>();
      const ev = { visibilityState: "hidden", addEventListener: (t: string, f: () => void) => void fl.set(t, f), removeEventListener: (t: string) => void fl.delete(t) };
      let calls = 0;
      const r = runner<number>({ name: "h", fetch: () => (calls++, Promise.resolve({ kind: "ok", value: 1 })), onOk: () => {}, focus: ev, visibility: ev, focusDebounceMs: debounce });
      return { r, ev, fl, calls: () => calls };
    };
    const h = make2();
    h.r.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(3 * EVERY_MS);
    expect(h.calls()).toBe(1);
    h.ev.visibilityState = "visible";
    h.fl.get("visibilitychange")?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(h.calls()).toBe(3);
    h.r.stop();
    const c = make2(2 * 60_000);
    c.ev.visibilityState = "visible";
    c.r.start();
    await vi.advanceTimersByTimeAsync(60_000);
    c.fl.get("focus")?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    c.fl.get("focus")?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.calls()).toBe(2);
    c.r.stop();
  });

  it("fetches at start, then every five minutes; stop ends it", async () => {    const st = stub(() => ({ kind: "ok", value: 1 }));
    const { r, oks } = make(st);
    r.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(st.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(st.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(st.calls).toBe(3);
    expect(oks).toEqual([1, 1, 1]);
    r.stop();
    await vi.advanceTimersByTimeAsync(3 * EVERY_MS);
    expect(st.calls).toBe(3);
  });

  it("recent figures survive repeated failures and the error mark stays steady through background retries", async () => {
    let fail = false;
    const st = stub(() => (fail ? { kind: "fail", message: "network down" } : { kind: "ok", value: 7 }));
    const { r, oks, fails, seen } = make(st);
    r.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(oks).toEqual([7]);
    fail = true;
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(st.calls).toBe(4);
    expect(oks).toEqual([7]); // never replaced by nothing
    expect(fails).toEqual(["network down", "network down", "network down"]);
    expect(r.state()).toMatchObject({ failures: 3, lastOk: t0 + 10 - 10 });
    // once failing, every published state keeps the mark up, including while a retry is in flight
    const sinceFirstFail = seen.slice(seen.findIndex((x) => x.failing));
    expect(sinceFirstFail.length).toBeGreaterThan(3);
    expect(sinceFirstFail.every((x) => x.failing)).toBe(true);
    r.stop();
  });

  it("one provider lagging never stalls the other", async () => {
    const slow = stub(() => new Promise<Fetched<number>>(() => {}));
    const quick = stub(() => ({ kind: "ok", value: 2 }));
    const a = make(slow, "slow");
    const b = make(quick, "quick");
    a.r.start();
    b.r.start();
    await vi.advanceTimersByTimeAsync(EVERY_MS + 10);
    expect(slow.calls).toBe(1);
    expect(a.oks).toEqual([]);
    expect(quick.calls).toBe(2);
    expect(b.oks).toEqual([2, 2]);
    expect(a.r.state().inFlight).toBe(true);
    expect(b.r.state().inFlight).toBe(false);
    a.r.stop();
    b.r.stop();
  });

  it("a read that brings nothing new is not a failure, and a busy provider is asked again shortly", async () => {
    let n = 0;
    const st = stub(() => (n++ === 0 ? { kind: "retry", inMs: 3_000 } : { kind: "nothing" }));
    const { r, oks, fails } = make(st);
    r.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(st.calls).toBe(1);
    expect(r.state().inFlight).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(st.calls).toBe(2);
    expect(oks).toEqual([]);
    expect(fails).toEqual([]);
    expect(r.state()).toMatchObject({ failures: 0, inFlight: false });
    expect(r.state().lastOk).not.toBeNull();
    r.stop();
  });

  it("a focus fetches after six minutes but not two seconds later; a manual refresh fetches at once", async () => {
    const st = stub(() => ({ kind: "ok", value: 1 }));
    const { r } = make(st);
    r.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(r.kick("focus")).toBe(false);
    vi.setSystemTime(t0 + 6 * MIN);
    expect(r.kick("focus")).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    vi.setSystemTime(t0 + 6 * MIN + 2_000);
    expect(r.kick("focus")).toBe(false);
    expect(refreshAll()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(st.calls).toBe(3);
    r.stop();
    expect(refreshAll()).toBe(0);
  });

  // USAGE-023: a screen reads the published state by provider name, so a runner that has stopped
  // must not leave its last state under that name for the next screen to read.
  it("a stopped runner publishes no state under its name", async () => {
    const st = stub(() => ({ kind: "ok", value: 1 }));
    const { r } = make(st, "probe");
    r.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(published("probe")).toMatchObject({ inFlight: false, lastOk: t0 });
    r.stop();
    expect(published("probe")).toEqual(fresh());
    expect(published("never-started")).toEqual(fresh());
  });
});

describe("the providers' answers as the scheduler reads them", () => {
  it("Claude: a report with windows is new figures, an empty one is nothing new (kept figures stay)", () => {
    expect(claudeFetched([{ kind: "seven_day", usedPercent: 3, resetsAt: null }])).toEqual({ kind: "ok", value: [{ kind: "seven_day", usedPercent: 3, resetsAt: null }] });
    expect(claudeFetched([])).toEqual({ kind: "nothing" });
  });

  it("Codex: busy means ask again in 3 s, error is a failure, every other state is an answer", () => {
    const base = { fiveHour: null, weekly: null, resetCredits: null, plan: null, message: null };
    expect(codexFetched({ ...base, state: "busy" })).toEqual({ kind: "retry", inMs: 3_000 });
    expect(codexFetched({ ...base, state: "error", message: "boom" })).toEqual({ kind: "fail", message: "boom" });
    expect(codexFetched({ ...base, state: "signed-out" })).toMatchObject({ kind: "ok" });
    expect(codexFetched({ ...base, state: "ok" })).toMatchObject({ kind: "ok" });
  });
});
