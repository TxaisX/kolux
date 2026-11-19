// Job 68 (job 63 item 5): a search for agents that never answers ends after 10 seconds with an error the user can
// act on; an answer that comes later still fills the list and clears the error. useWindowStart is drawn in a probe
// (as useStartAsk.test.ts does) with fake timers; agent_list answers only when the test says so.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

let answer: (list: unknown[]) => void = () => {};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => (cmd === "agent_list" ? new Promise((r) => (answer = r)) : new Promise(() => {})),
}));
const heard: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, f: (e: { payload: unknown }) => void) => ((heard[name] = f), Promise.resolve(() => {})), emit: () => Promise.resolve() }));
import { canLaunch } from "../launch/agents";
import { installDom } from "../test/fakeDom";
import { AGENT_SEARCH_LIMIT_MS, useWindowStart } from "./useWindowStart";

type Pass = { looking: boolean; done: boolean; error: string | null; slow?: boolean };
afterEach(() => void vi.useRealTimers());

async function draw() {
  vi.useFakeTimers();
  const { doc } = installDom();
  const held: { pass: Pass; agents: unknown[] } = { pass: { looking: false, done: false, error: null }, agents: [] };
  const put = <T,>(v: T | ((p: T) => T), now: T): T => (typeof v === "function" ? (v as (p: T) => T)(now) : v);
  function Probe() {
    useWindowStart({
      agentPass: held.pass, installedIds: [],
      setAgentPass: ((v: Pass | ((p: Pass) => Pass)) => void (held.pass = put(v, held.pass))) as never,
      setAgents: ((v: unknown[]) => void (held.agents = v)) as never,
      setInfo: (() => {}) as never, setPanes: (() => {}) as never, setSettings: (() => {}) as never,
      setSettingsRead: (() => {}) as never, setShells: (() => {}) as never,
    });
    return null;
  }
  const { createRoot } = await import("react-dom/client");
  const root: Root = createRoot(doc.createElement("div") as unknown as Element);
  act(() => root.render(createElement(Probe)));
  return { held, root };
}

test("job 68: a search for agents with no answer ends after 10 seconds and says to press Refresh agents", async () => {
  const { held, root } = await draw();
  expect(held.pass.looking).toBe(true);
  act(() => void vi.advanceTimersByTime(AGENT_SEARCH_LIMIT_MS - 1));
  expect(held.pass).toMatchObject({ looking: true, error: null });
  act(() => void vi.advanceTimersByTime(1));
  expect(held.pass.looking).toBe(false);
  expect(held.pass.done).toBe(false);
  expect(held.pass.error).toBe("the search took longer than 10 seconds"); // job 78 R73-4: the Refresh agents button sits below it
  act(() => root.unmount());
});

test("job 68: an answer after the 10 seconds still fills the list and clears the error", async () => {
  const { held, root } = await draw();
  act(() => void vi.advanceTimersByTime(AGENT_SEARCH_LIMIT_MS));
  expect(held.pass.error).not.toBeNull();
  await act(async () => answer([{ id: "claude" }]));
  expect(held.agents).toEqual([{ id: "claude" }]);
  expect(held.pass).toEqual({ looking: false, done: true, error: null });
  act(() => root.unmount());
});

test("job 68: an answer in time leaves no error when the 10 seconds pass", async () => {
  const { held, root } = await draw();
  await act(async () => answer([]));
  act(() => void vi.advanceTimersByTime(AGENT_SEARCH_LIMIT_MS * 2));
  expect(held.pass).toEqual({ looking: false, done: true, error: null });
  act(() => root.unmount());
});

test("job 78 R73-2: a second search started 9 s into the first is not ended by the first one's timer", async () => {
  const { held, root } = await draw();
  act(() => void vi.advanceTimersByTime(AGENT_SEARCH_LIMIT_MS - 1000));
  act(() => heard["agents-changed"]({ payload: null })); // an install finished: search B starts
  act(() => void vi.advanceTimersByTime(1000)); // search A's 10 s are up
  expect(held.pass).toMatchObject({ looking: true, error: null });
  act(() => void vi.advanceTimersByTime(AGENT_SEARCH_LIMIT_MS - 1000)); // search B's own 10 s are up
  expect(held.pass.looking).toBe(false);
  expect(held.pass.error).not.toBeNull();
  act(() => root.unmount());
});

test("job 78 R73-3: a search that never answers after a good one keeps Start working with the last list", async () => {
  const { held, root } = await draw();
  await act(async () => answer([{ id: "claude" }]));
  act(() => heard["agents-changed"]({ payload: null })); // a second search that never answers
  act(() => void vi.advanceTimersByTime(AGENT_SEARCH_LIMIT_MS));
  expect(held.pass).toMatchObject({ looking: false, done: true, error: null, slow: true });
  expect(canLaunch(held.pass)).toBe(true);
  expect(held.agents).toEqual([{ id: "claude" }]);
  await act(async () => answer([{ id: "codex" }])); // it answers late: the list lands and the note goes
  expect(held.pass).toEqual({ looking: false, done: true, error: null });
  act(() => root.unmount());
});
