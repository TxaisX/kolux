// N-03: one stamp poll for every visible editor tab. The batching is what is tested: N tabs, one
// `file_stamps` call per round, each tab still answered by its own file's stamp.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stamp } from "./diskChange";

const h = vi.hoisted(() => ({
  calls: [] as string[][],
  fail: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (_cmd: string, args: { paths: string[] }) => {
    h.calls.push(args.paths);
    if (h.fail) return Promise.reject(new Error("no answer"));
    return Promise.resolve(args.paths.map((p) => ({ mtime: p.length, size: 1 })));
  },
}));

const { answersFor, roundPaths, stopAllStamps, watchStamp } = await import("./stampPoll");

const ticks: Array<() => void> = [];
const soon: Array<() => void> = [];
let listeners = 0;

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const runSoon = async () => {
  for (const fn of soon.splice(0)) fn();
  await flush();
};

beforeEach(() => {
  h.calls.length = 0;
  h.fail = false;
  ticks.length = 0;
  soon.length = 0;
  vi.stubGlobal("window", {
    setInterval: (fn: () => void) => ticks.push(fn),
    clearInterval: () => undefined,
    setTimeout: (fn: () => void) => soon.push(fn),
    clearTimeout: () => undefined,
    addEventListener: () => void (listeners += 1),
    removeEventListener: () => void (listeners -= 1),
  });
});

afterEach(() => {
  stopAllStamps();
  vi.unstubAllGlobals();
  listeners = 0;
});

describe("N-03: every visible tab shares one disk-stamp poll", () => {
  it("asks for every watched path once, and answers each tab with its own file", async () => {
    const a: (Stamp | null)[] = [];
    const b: (Stamp | null)[] = [];
    const a2: (Stamp | null)[] = [];
    const offA = watchStamp("C:/r/a.ts", (s) => a.push(s));
    watchStamp("C:/r/a.ts", (s) => a2.push(s));
    watchStamp("C:/r/b.ts", (s) => b.push(s));
    await runSoon();
    expect(h.calls).toEqual([["C:/r/a.ts", "C:/r/b.ts"]]); // one call for three watchers, no repeats
    expect([a[a.length - 1], b[b.length - 1]]).toEqual([{ mtime: 9, size: 1 }, { mtime: 9, size: 1 }]);
    expect(a2).toEqual(a); // two panes on one file share the one answer
    // The next tick is one call again, and it reuses the same interval.
    ticks[0]();
    await flush();
    expect(h.calls).toEqual([
      ["C:/r/a.ts", "C:/r/b.ts"],
      ["C:/r/a.ts", "C:/r/b.ts"],
    ]);
    expect(ticks.length).toBe(1);
    offA();
    ticks[0]();
    await flush();
    expect(h.calls[h.calls.length - 1]).toEqual(["C:/r/a.ts", "C:/r/b.ts"]);
  });

  it("stops the interval with the last watcher, and starts one window focus listener in between", async () => {
    const off = watchStamp("C:/r/a.ts", () => undefined);
    expect(ticks.length).toBe(1);
    expect(listeners).toBe(1);
    off();
    expect(ticks.length).toBe(1);
    expect(listeners).toBe(0);
    // A watcher again starts a fresh interval, not a second one on top.
    watchStamp("C:/r/a.ts", () => undefined);
    expect(ticks.length).toBe(2);
  });

  it("leaves a file unseen when the round's ask fails, the answer a lone tab got", async () => {
    h.fail = true;
    const got: (Stamp | null)[] = [];
    watchStamp("C:/r/a.ts", (s) => got.push(s));
    await runSoon();
    expect(got).toEqual([null]);
  });
});

describe("N-03: the round itself", () => {
  it("asks for each path once, in the order first watched", () => {
    expect(roundPaths(["C:/b", "C:/a", "C:/b"])).toEqual(["C:/b", "C:/a"]);
    expect(roundPaths([])).toEqual([]);
  });
  it("lines the answer up with the paths, short and failed answers unseen", () => {
    const stamp = { mtime: 1, size: 2 };
    expect(answersFor(["a", "b"], [stamp, null])).toEqual([stamp, null]);
    expect(answersFor(["a", "b"], [stamp])).toEqual([stamp, null]);
    expect(answersFor(["a"], null)).toEqual([null]);
  });
});