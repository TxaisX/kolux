// USAGE-023 acceptance: the real refresh runner (the one ClaudePill, CodexPill and paneFigures use) with a fake clock
// and a fake window-focus source.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EVERY_MS, MOMENTS_MS, claudeFetched, codexFetched, runner, type Fetched } from "../refresh";

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const focusSource = () => {
  const fns = new Set<() => void>();
  return { addEventListener: (_: string, f: () => void) => void fns.add(f), removeEventListener: (_: string, f: () => void) => void fns.delete(f), focus: () => fns.forEach((f) => f()) };
};

test("box 1: with the network cut the shown figures keep their last values; restored, the next focus refreshes them", async () => {
  let online = true;
  let figure = 41;
  const shown: number[] = []; // what is on screen: only onOk ever replaces it
  const win = focusSource();
  const r = runner<number>({
    name: "claude-1",
    fetch: () => Promise.resolve(online ? ({ kind: "ok", value: figure } as Fetched<number>) : ({ kind: "fail", message: "network unreachable" } as Fetched<number>)),
    onOk: (v) => shown.push(v),
    focus: win,
    visibility: null,
  });
  r.start();
  await vi.advanceTimersByTimeAsync(10);
  expect(shown).toEqual([41]);
  online = false;
  figure = 55; // what the provider would say once reachable
  for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(EVERY_MS);
  expect(r.state().failures).toBe(3);
  expect(shown).toEqual([41]); // last known value kept, never blanked or replaced
  online = true;
  await vi.advanceTimersByTimeAsync(5 * MOMENTS_MS); // past the back-off, before the next timer tick
  expect(shown).toEqual([41]); // nothing refreshed yet: only the focus will do it
  win.focus();
  await vi.advanceTimersByTimeAsync(10);
  expect(shown[shown.length - 1]).toBe(55);
  expect(r.state().failures).toBe(0);
  r.stop();
});

test("box 2: a provider that never answers does not hold Claude or Codex back", async () => {
  // Kolux has no Grok usage read (USAGE-018, P1, unbuilt): the slow provider is a stand-in running the same real runner.
  const slowCalls = { n: 0 };
  const slow = runner<number>({ name: "slow-grok", fetch: () => ((slowCalls.n += 1), new Promise<Fetched<number>>(() => {})), onOk: () => {}, focus: null, visibility: null });
  const claudeShown: unknown[] = [];
  const codexShown: unknown[] = [];
  let tick = 0;
  const claude = runner({ name: "claude-2", fetch: async () => claudeFetched([{ kind: "five_hour", usedPercent: 10 + ++tick, resetsAt: null }]), onOk: (v) => claudeShown.push(v), focus: null, visibility: null });
  const codex = runner({
    name: "codex-2",
    fetch: async () => codexFetched({ state: "ok", fiveHour: { usedPercent: 20 + tick, resetsAt: null, windowMins: 300 }, weekly: null, resetCredits: null, plan: null, message: null }),
    onOk: (v) => codexShown.push(v),
    focus: null,
    visibility: null,
  });
  slow.start();
  claude.start();
  codex.start();
  await vi.advanceTimersByTimeAsync(10);
  expect(claudeShown).toHaveLength(1);
  expect(codexShown).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(EVERY_MS);
  expect(claudeShown).toHaveLength(2);
  expect(codexShown).toHaveLength(2);
  expect(slow.state().inFlight).toBe(true);
  expect(slowCalls.n).toBe(1); // still waiting on its first read
  expect(claude.state().inFlight).toBe(false);
  expect(codex.state().inFlight).toBe(false);
  for (const r of [slow, claude, codex]) r.stop();
});
