// LAG-04A (board test, hash-locked): the window notices when its main thread was blocked for long and
// leaves one line in the app log naming how long, when and where. Two freezes of 20 s on 2026-11-23 left
// nothing behind; after this card the next one does. Counts and a fake clock only: nothing here waits.
import { describe, expect, test } from "vitest";
import {
  LONG_TASK_BUDGET,
  LONG_TASK_MS,
  LONG_TASK_WINDOW_MS,
  createLongTaskLimiter,
  installLongTaskWatch,
  isLongTask,
  longTaskRecord,
  type LongTaskEntry,
  type LongTaskRecord,
} from "./longTask";
import longRaw from "./longTask.ts?raw";
import mainRaw from "../main.tsx?raw";

/** A fake PerformanceObserver: remembers what it was asked to observe and lets the test deliver entries. */
function fakeObserver(opts: { throwOnObserve?: boolean } = {}) {
  const made: { cb: (list: { getEntries(): LongTaskEntry[] }) => void; observed: unknown[] }[] = [];
  class Fake {
    observed: unknown[] = [];
    constructor(cb: (list: { getEntries(): LongTaskEntry[] }) => void) {
      made.push({ cb, observed: this.observed });
    }
    observe(o: unknown) {
      if (opts.throwOnObserve) throw new Error("longtask is not supported");
      this.observed.push(o);
    }
  }
  const deliver = (entries: LongTaskEntry[]) => made[0].cb({ getEntries: () => entries });
  return { Fake, made, deliver };
}

function harness(opts: { throwOnObserve?: boolean; visibility?: string } = {}) {
  let t = 1_000_000;
  const sent: LongTaskRecord[] = [];
  const obs = fakeObserver(opts);
  const installed = installLongTaskWatch({
    Observer: obs.Fake as never,
    send: (r) => void sent.push(r),
    now: () => t,
    visibility: () => opts.visibility ?? "visible",
  });
  return { installed, sent, obs, advance: (ms: number) => void (t += ms) };
}

const block = (duration: number, startTime = 5000, name = "self"): LongTaskEntry => ({ duration, startTime, name });

describe("longTask", () => {
  test("the limits are the ones the card names", () => {
    expect(LONG_TASK_MS).toBe(500);
    expect(LONG_TASK_BUDGET).toBe(5);
    expect(LONG_TASK_WINDOW_MS).toBe(60_000);
  });

  test("a block counts from 500 ms; shorter or broken durations do not", () => {
    expect(isLongTask(499)).toBe(false);
    expect(isLongTask(499.9)).toBe(false);
    expect(isLongTask(500)).toBe(true);
    expect(isLongTask(501)).toBe(true);
    expect(isLongTask(20_000)).toBe(true);
    expect(isLongTask(0)).toBe(false);
    expect(isLongTask(-600)).toBe(false);
    expect(isLongTask(Number.NaN)).toBe(false);
    expect(isLongTask(Number.POSITIVE_INFINITY)).toBe(false);
  });

  test("a 20 s block becomes one record naming its duration, start and context", () => {
    expect(longTaskRecord({ duration: 20_034.4, startTime: 123_456.7, name: "self" }, "visible")).toEqual({
      name: "long:20034:self:visible",
      ms: 123_457,
    });
    expect(longTaskRecord({ duration: 500, startTime: 0, name: "cross-origin-descendant" }, "hidden")).toEqual({
      name: "long:500:cross-origin-descendant:hidden",
      ms: 0,
    });
  });

  test("a short block makes no record", () => {
    expect(longTaskRecord(block(99), "visible")).toBeNull();
    expect(longTaskRecord(block(499.9), "visible")).toBeNull();
    expect(longTaskRecord(block(Number.NaN), "visible")).toBeNull();
  });

  test("the record name keeps only log-safe characters and never exceeds 48 characters", () => {
    expect(longTaskRecord({ duration: 800, startTime: 10, name: "a b.c\n\u001b[2J:x" }, "vis ible\r\n")).toEqual({
      name: "long:800:abc2Jx:visible",
      ms: 10,
    });
    expect(longTaskRecord({ duration: 800, startTime: 10, name: "" }, "")?.name).toBe("long:800:unknown:unknown");
    expect(longTaskRecord({ duration: 800, startTime: 10 }, "visible")?.name).toBe("long:800:unknown:visible");
    const long = longTaskRecord({ duration: 1234, startTime: 10, name: "x".repeat(300) }, "visible")!;
    expect(long.name.length).toBe(48);
    expect(long.name.startsWith("long:1234:xxx")).toBe(true);
    expect(long.name).toMatch(/^[A-Za-z0-9_:-]+$/);
  });

  test("a start time that is not a finite non-negative number is written as 0", () => {
    expect(longTaskRecord({ duration: 600, startTime: Number.NaN, name: "self" }, "visible")?.ms).toBe(0);
    expect(longTaskRecord({ duration: 600, startTime: -5, name: "self" }, "visible")?.ms).toBe(0);
  });

  test("the limiter lets 5 records through per minute and counts the rest as dropped", () => {
    let t = 50_000;
    const lim = createLongTaskLimiter(() => t);
    const allowed = Array.from({ length: 1000 }, () => lim.allow()).filter(Boolean).length;
    expect(allowed).toBe(5);
    expect(lim.dropped()).toBe(995);
    t += 59_999;
    expect(lim.allow()).toBe(false);
    expect(lim.dropped()).toBe(996);
    t += 1; // 60 000 ms after the window opened: a new window
    expect(lim.allow()).toBe(true);
    expect(lim.dropped()).toBe(996);
  });

  test("the watch observes long tasks once, buffered", () => {
    const h = harness();
    expect(h.installed).toBe(true);
    expect(h.obs.made.length).toBe(1);
    expect(h.obs.made[0].observed).toEqual([{ type: "longtask", buffered: true }]);
  });

  test("a 20 s freeze leaves exactly one record with the right fields", () => {
    const h = harness();
    h.obs.deliver([block(20_000, 98_765.4, "self")]);
    expect(h.sent).toEqual([{ name: "long:20000:self:visible", ms: 98_765 }]);
  });

  test("short blocks leave nothing", () => {
    const h = harness();
    h.obs.deliver([block(99), block(120), block(499.9)]);
    expect(h.sent).toEqual([]);
  });

  test("a storm of long blocks is capped, and the cap opens again after a minute", () => {
    const h = harness();
    h.obs.deliver(Array.from({ length: 200 }, (_, i) => block(700 + i, i * 1000)));
    expect(h.sent.length).toBe(5);
    h.obs.deliver([block(900)]);
    expect(h.sent.length).toBe(5);
    h.advance(60_000);
    h.obs.deliver([block(900, 7000, "self")]);
    expect(h.sent.length).toBe(6);
    expect(h.sent[5]).toEqual({ name: "long:900:self:visible", ms: 7000 });
  });

  test("short blocks do not use up the budget", () => {
    const h = harness();
    h.obs.deliver(Array.from({ length: 50 }, () => block(100)));
    h.obs.deliver([block(20_000)]);
    expect(h.sent.length).toBe(1);
  });

  test("a window without the observer, or one that refuses longtask, starts normally", () => {
    const sent: LongTaskRecord[] = [];
    expect(installLongTaskWatch({ Observer: null, send: (r) => void sent.push(r), now: () => 0, visibility: () => "visible" })).toBe(false);
    const h = harness({ throwOnObserve: true });
    expect(h.installed).toBe(false);
    expect(sent).toEqual([]);
  });

  test("a send that throws never breaks the watch", () => {
    let calls = 0;
    const obs = fakeObserver();
    const ok = installLongTaskWatch({
      Observer: obs.Fake as never,
      send: () => {
        calls++;
        throw new Error("backend gone");
      },
      now: () => 0,
      visibility: () => "visible",
    });
    expect(ok).toBe(true);
    expect(() => obs.deliver([block(800), block(900)])).not.toThrow();
    expect(calls).toBe(2);
  });
});

const code = (raw: string) =>
  raw
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");

describe("LAG-04A wiring", () => {
  test("the window starts the long-task watch at load", () => {
    const src = code(mainRaw);
    expect(src).toMatch(/import\s*\{[^}]*\binstallLongTaskWatch\b[^}]*\}\s*from\s*"\.\/recovery\/longTask"/);
    const call = src.search(/^\s*(void\s+)?installLongTaskWatch\(\s*\)\s*;?\s*$/m);
    expect(call).toBeGreaterThan(-1);
    const startCall = src.search(/^void start\(\)/m);
    expect(startCall).toBeGreaterThan(-1);
    expect(call).toBeLessThan(startCall);
  });

  test("the record goes to the app log through the existing boot_timing command", () => {
    const src = code(longRaw);
    expect(src).toMatch(/import\s*\{[^}]*\binvoke\b[^}]*\}\s*from\s*"@tauri-apps\/api\/core"/);
    expect(src).toMatch(/invoke\(\s*"boot_timing"\s*,\s*\{[^}]*\bname\b[^}]*\bms\b[^}]*\}\s*\)/);
    expect(src).toMatch(/\.catch\(/);
  });
});
