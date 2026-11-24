// LAG-02 (board card LAG-02-STATUS): an agent-status, usage, quiet or title event that changes
// nothing must not make new window state. Counts, not times: each "change" below is one new state
// object, which is one React commit of the whole window. Locked board file: do not edit.
import { describe, expect, it, vi } from "vitest";
import { putIfChanged, sameValue } from "./sameState";
import { identityPacer, IDLE, reduceIdentity, TITLE_PACE_MS, titleFrameKey, type Identity, type Mark } from "../terminal/shellMarks";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");

type Turnish = { tool?: string; detail?: string; ask?: string; reply?: string; wrote?: string; stop?: { cause: string; detail?: string }; plan?: string; planCut?: boolean; monitoring?: boolean };

/** A fresh object every call, as each hook event's JSON payload is. */
const turnPayload = (k: number): Turnish => ({ tool: "Bash", detail: `npm test ${k}`, ask: undefined, reply: undefined, stop: { cause: "limit", detail: "5h" }, plan: undefined, planCut: false, monitoring: undefined, wrote: "src/a.ts" });
const crewPayload = (k: number) => [{ id: `sub-${k}`, kind: "Explore", model: "haiku", state: "working" as const }];

/** Feeds `next` through putIfChanged `n` times; returns how many calls made a new object. */
function changes<T>(start: Record<number, T>, key: number, next: () => T, n: number): { count: number; end: Record<number, T> } {
  let s = start;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const after = putIfChanged(s, key, next());
    if (after !== s) count++;
    s = after;
  }
  return { count, end: s };
}

describe("LAG-02: a repeated, unchanged status event makes no new state", () => {
  it("sameValue compares JSON-like payloads by content", () => {
    expect(sameValue({ a: 1, b: { c: [1, 2, { d: "x" }] } }, { b: { c: [1, 2, { d: "x" }] }, a: 1 })).toBe(true);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameValue({ a: 1, b: null }, { a: 1 })).toBe(false);
    expect(sameValue(null, undefined)).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue({ a: [1] }, { a: { 0: 1 } })).toBe(false);
    expect(sameValue({ a: 1 }, { a: "1" })).toBe(false);
    expect(sameValue(true, true)).toBe(true);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
    expect(sameValue({ stop: { cause: "limit" } }, { stop: { cause: "error" } })).toBe(false);
    expect(sameValue({}, [])).toBe(false);
  });

  it("putIfChanged gives back the same object when nothing changed, a new one for a real change", () => {
    const before: Record<number, Turnish> = { 1: turnPayload(1), 2: turnPayload(2) };
    const frozen = JSON.stringify(before);
    expect(putIfChanged(before, 1, turnPayload(1))).toBe(before);
    const changed = putIfChanged(before, 1, { ...turnPayload(1), detail: "npm run build" });
    expect(changed).not.toBe(before);
    expect(changed[1].detail).toBe("npm run build");
    expect(changed[2]).toBe(before[2]);
    const added = putIfChanged(before, 3, turnPayload(3));
    expect(added).not.toBe(before);
    expect(Object.keys(added).sort()).toEqual(["1", "2", "3"]);
    // A pane with no entry yet gets one even when the value is "empty".
    const stale: Record<number, boolean> = {};
    expect(putIfChanged(stale, 4, false)).not.toBe(stale);
    expect(putIfChanged({ 4: true }, 4, false)).toEqual({ 4: false });
    // Never mutates what it was given.
    expect(JSON.stringify(before)).toBe(frozen);
    expect(before[3]).toBeUndefined();
  });

  it("the same agent-status payload 50 times makes one change", () => {
    expect(changes<Turnish>({}, 7, () => turnPayload(7), 50).count).toBe(1);
    expect(changes({}, 7, () => crewPayload(7), 50).count).toBe(1);
    expect(changes<boolean>({}, 7, () => true, 50).count).toBe(1);
    expect(changes({}, 7, () => ({ tokens: 41_000, window: 200_000, session: "s-7", at: 1234, costUsd: 0.42 }), 50).count).toBe(1);
  });

  it("10 panes sending unchanged status for 200 ticks make 10 changes, none after the first", () => {
    let turn: Record<number, Turnish> = {};
    let crew: Record<number, ReturnType<typeof crewPayload>> = {};
    let stale: Record<number, boolean> = {};
    let commits = 0;
    let lateCommits = 0;
    for (let tick = 0; tick < 200; tick++) {
      for (let k = 1; k <= 10; k++) {
        const t = putIfChanged(turn, k, turnPayload(k));
        const c = putIfChanged(crew, k, crewPayload(k));
        const s = putIfChanged(stale, k, true);
        const moved = t !== turn || c !== crew || s !== stale;
        if (moved) commits++;
        if (moved && tick > 0) lateCommits++;
        turn = t;
        crew = c;
        stale = s;
      }
    }
    expect(commits).toBe(10);
    expect(lateCommits).toBe(0);
    // A real change on one pane, later, is one more change and only for that pane.
    const before = turn;
    const after = putIfChanged(turn, 5, { ...turnPayload(5), tool: "Edit" });
    expect(after).not.toBe(before);
    expect(after[4]).toBe(before[4]);
  });

  it("the agent-status, usage and quiet listeners go through putIfChanged", () => {
    const src = nodeFs.readFileSync(new URL("./useAgentStatus.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(src).toMatch(/import\s*\{[^}]*\bputIfChanged\b[^}]*\}\s*from\s*"\.\/sameState"/);
    expect(src).toMatch(/setTurn\(\(\w+\)\s*=>[\s\S]{0,400}?putIfChanged\(/);
    expect(src).toMatch(/setCrew\(\(\w+\)\s*=>[\s\S]{0,200}?putIfChanged\(/);
    expect(src).toMatch(/setContext\(\(\w+\)\s*=>\s*putIfChanged\(/);
    // agent-quiet and agent-unverified both mark the pane quiet through it.
    expect(src.match(/setStale\(\(\w+\)\s*=>\s*putIfChanged\(\s*\w+\s*,\s*e\.payload\.paneKey\s*,\s*true\s*\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // The old always-new spreads are gone.
    expect(src).not.toMatch(/setTurn\(\(\w+\)\s*=>\s*\(\{\s*\.\.\.\w+\s*,/);
    expect(src).not.toMatch(/setContext\(\(\w+\)\s*=>\s*\(\{\s*\.\.\.\w+\s*,/);
    expect(src).not.toMatch(/setStale\(\(\w+\)\s*=>\s*\(\{\s*\.\.\.\w+\s*,\s*\[e\.payload\.paneKey\]\s*:\s*true/);
  });
});

const title = (text: string): Mark => ({ kind: "title", text }) as Mark;
const SPIN = ["⠂", "⠐", "⠠", "⠄"];

/** `panes` shell panes, each with its own pacer (one apply = one window commit); an agent starts in
 *  each, then every `gap` ms each pane prints `frame(i)` as its title, `ticks` times; then quiet. */
function animate(panes: number, ticks: number, gap: number, frame: (i: number) => string) {
  vi.useFakeTimers();
  try {
    const applied: Identity[][] = Array.from({ length: panes }, () => []);
    const pacers = applied.map((list) => identityPacer((id) => list.push(id)));
    const now: Identity[] = applied.map(() => IDLE);
    const note = (k: number, m: Mark) => {
      const next = reduceIdentity(now[k], m);
      if (next === now[k]) return; // TerminalPane.noteIdentity's own check
      now[k] = next;
      pacers[k].note(next);
    };
    for (let k = 0; k < panes; k++) {
      note(k, { kind: "start" } as Mark);
      note(k, title("✳ Fix the login bug"));
    }
    const atStart = applied.map((l) => l.length);
    for (let i = 0; i < ticks; i++) {
      for (let k = 0; k < panes; k++) note(k, title(frame(i)));
      vi.advanceTimersByTime(gap);
    }
    const during = applied.map((l, k) => l.length - atStart[k]);
    vi.advanceTimersByTime(TITLE_PACE_MS * 3);
    const after = applied.map((l, k) => l.length - atStart[k] - during[k]);
    for (const p of pacers) p.stop();
    return { atStart, during, after, last: applied.map((l) => l[l.length - 1]), now };
  } finally {
    vi.useRealTimers();
  }
}

describe("LAG-02: title frames of an animating agent stay out of the window", () => {
  it("titleFrameKey drops only the leading spinner decoration", () => {
    expect(titleFrameKey("⠂ Fix the login bug")).toBe("Fix the login bug");
    expect(titleFrameKey("⠐ Fix the login bug")).toBe("Fix the login bug");
    expect(titleFrameKey("✳ Claude Code")).toBe("Claude Code");
    expect(titleFrameKey("  ◐ ✶ build")).toBe("build");
    expect(titleFrameKey("✋ Allow edit?")).toBe("✋ Allow edit?");
    expect(titleFrameKey("vim notes.md")).toBe("vim notes.md");
    expect(titleFrameKey("Fix ⠂ bug")).toBe("Fix ⠂ bug");
    expect(titleFrameKey("⠂⠐")).toBe("");
    expect(titleFrameKey(null)).toBeNull();
  });

  it("10 panes animating a spinner for 10 seconds hand the window one title each, after the spinner stops", () => {
    const r = animate(10, 100, 100, (i) => `${SPIN[i % 4]} Fix the login bug`);
    // The agent appearing goes at once (running, then agent): two applies per pane.
    expect(r.atStart).toEqual(Array(10).fill(2));
    // Amended 2026-11-24 (coordinator): the one idle->working flip must reach the paced title; frame-to-frame changes stay held.
    expect(r.during).toEqual(Array(10).fill(1));
    // Once it stops: exactly one apply per pane, and it is the newest frame.
    expect(r.after).toEqual(Array(10).fill(1));
    for (let k = 0; k < 10; k++) {
      expect(r.last[k]).toBe(r.now[k]);
      expect(r.last[k].title).toBe(`${SPIN[99 % 4]} Fix the login bug`);
      expect(r.last[k].agent).toBe("claude");
    }
  });

  it("10 panes repeating the same title for 100 ticks hand the window nothing after the agent appears", () => {
    const r = animate(10, 100, 100, () => "✳ Fix the login bug");
    expect(r.during.reduce((a, b) => a + b, 0)).toBe(0);
    expect(r.after.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("a real title change still lands within the pace, while the spinner keeps turning", () => {
    vi.useFakeTimers();
    try {
      const applied: { id: Identity; at: number }[] = [];
      const pacer = identityPacer((id) => applied.push({ id, at: Date.now() }));
      let now = reduceIdentity(reduceIdentity(IDLE, { kind: "start" } as Mark), title("✳ Fix the login bug"));
      pacer.note(now);
      const t0 = Date.now();
      const base = applied.length;
      now = reduceIdentity(now, title("⠂ Run the tests"));
      pacer.note(now);
      for (let i = 1; i <= 10; i++) {
        vi.advanceTimersByTime(50);
        now = reduceIdentity(now, title(`${SPIN[i % 4]} Run the tests`));
        pacer.note(now);
      }
      const landed = applied.slice(base).find((a) => titleFrameKey(a.id.title) === "Run the tests");
      expect(landed).toBeDefined();
      expect((landed as { at: number }).at - t0).toBeLessThanOrEqual(TITLE_PACE_MS);
      expect(applied.length - base).toBeLessThanOrEqual(2);
      // A change of running is never held back by the spinner.
      pacer.note(IDLE);
      expect(applied[applied.length - 1].id).toBe(IDLE);
      pacer.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
