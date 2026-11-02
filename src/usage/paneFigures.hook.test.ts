// T-548-b (review C): the lifecycle of useClaudePaneFigures, driven without a renderer: the hooks are
// replaced by a tiny harness that re-runs an effect (cleanup first) only when its dependencies changed.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Effect = { fn: () => void | (() => void); deps: unknown[]; cleanup?: void | (() => void) };
const effects: Effect[] = [];
const refs: Array<{ current: unknown }> = [];
let at = 0;
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useRef: (init: unknown) => (refs[at] ??= { current: init }, refs[at++]),
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const i = at++;
    const prev = effects[i];
    if (prev && prev.deps.length === deps.length && prev.deps.every((d, j) => Object.is(d, deps[j]))) return;
    prev?.cleanup?.();
    effects[i] = { fn, deps };
    pending.push(i);
  },
}));
const pending: number[] = [];

const readers: Array<{ name: string; started: boolean; stopped: boolean }> = [];
vi.mock("./refresh", async (orig) => ({
  ...(await orig<typeof import("./refresh")>()),
  runner: (o: { name: string }) => {
    const r = { name: o.name, started: false, stopped: false };
    readers.push(r);
    return { start: () => (r.started = true), stop: () => (r.stopped = true) };
  },
}));
const handlers: Array<{ name: string; f: (e: { payload: unknown }) => void; off: ReturnType<typeof vi.fn> }> = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, f: (e: { payload: unknown }) => void) => {
    const off = vi.fn();
    handlers.push({ name, f, off });
    return off;
  },
}));
const asked: Array<[string, unknown]> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (c: string, a?: unknown) => {
    asked.push([c, a]);
    return c === "claude_accounts" ? { accounts: [{ id: "a", configDir: "C:/u/a" }, { id: "b", configDir: "C:/u/b" }] } : [{ kind: "five_hour", usedPercent: 7, resetsAt: null }];
  },
}));

const { useClaudePaneFigures } = await import("./paneFigures");
const { readPlan, publishClaudeFor } = await import("./plan");

function render(panes: Array<{ agent: string; account?: string | null }>, active: string | null) {
  at = 0;
  pending.length = 0;
  useClaudePaneFigures(panes, active);
  for (const i of pending) effects[i].cleanup = effects[i].fn();
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  effects.length = 0;
  refs.length = 0;
  readers.length = 0;
  handlers.length = 0;
  asked.length = 0;
});
afterEach(() => {
  effects.forEach((e) => e.cleanup?.());
  ["a", "b", null].forEach((id) => publishClaudeFor(id, null));
});

test("T-548-b: a reader is added for each other Claude account a pane is on, and one event listener serves them all", async () => {
  render([{ agent: "claude", account: "a" }, { agent: "claude", account: "b" }, { agent: "claude", account: null }], "a");
  await tick();
  expect(readers.map((r) => r.name).length).toBe(2);
  expect(readers.every((r) => r.started && !r.stopped)).toBe(true);
  expect(handlers.map((h) => h.name)).toEqual(["claude-usage-of"]);
  expect(readPlan().claudeActive).toBe("a");
});

test("T-548-b: one claude-usage-of event reads one account; the old claude-usage event is not listened to", async () => {
  render([{ agent: "claude", account: "b" }, { agent: "claude", account: null }], "a");
  await tick();
  asked.length = 0;
  handlers[0].f({ payload: "c:/U/b/" });
  await tick();
  expect(asked.filter((c) => c[0] === "claude_usage_of")).toEqual([["claude_usage_of", { configDir: "c:/U/b/" }]]);
  expect(readPlan().claudeBy?.b?.[0].usedPercent).toBe(7);
  expect(readPlan().claudeBy?.[""]).toBeUndefined(); // the default sign-in was not read
  expect(handlers.some((h) => h.name === "claude-usage")).toBe(false);
});

test("T-548-b: an account no pane needs any more loses its reader, its listener and its windows; an unchanged set restarts nothing", async () => {
  const both = [{ agent: "claude", account: "b" }, { agent: "claude", account: null }];
  render(both, "a");
  await tick();
  handlers[0].f({ payload: "C:/u/b" });
  await tick();
  expect(readPlan().claudeBy?.b).toBeDefined();
  const before = readers.length;
  render(both, "a"); // nothing changed
  expect(readers.length).toBe(before);
  render([{ agent: "claude", account: null }], "a"); // the pane on b is gone
  await tick();
  expect(readers[0].stopped).toBe(true); // b's reader (the first wanted)
  expect(handlers[0].off).toHaveBeenCalled();
  expect(readPlan().claudeBy?.b).toBeUndefined();
  // and with no pane on another account there is no reader and no listener at all
  const listeners = handlers.length;
  render([{ agent: "claude", account: "a" }], "a");
  await tick();
  expect(handlers.length).toBe(listeners);
  expect(readers.filter((r) => !r.stopped)).toEqual([]);
});
