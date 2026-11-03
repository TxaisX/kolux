// SKILL-027: the store that follows a skill update for the status bar, driven by fake timers and a fake app.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FADE_MS } from "./skillBar";
import { MAX_POLL_FAILS, POLL_FAILED, POLL_MS, createSkillBar, type Clock } from "./skillBarStore";
import type { UpdateStatus } from "./updateNotice";

const st = (over: Partial<UpdateStatus>): UpdateStatus => ({ state: "done", names: ["a", "b"], command: "", log: "", code: 0, stopped: false, error: null, results: [], ...over });
const clock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

let backend: UpdateStatus;
let calls: string[];
const call = (<T>(cmd: string): Promise<T> => {
  calls.push(cmd);
  if (cmd === "skills_update_status") return Promise.resolve(backend as T);
  if (cmd === "skills_update_clear") backend = st({ state: "idle", names: [] });
  return Promise.resolve(undefined as T);
}) as Parameters<typeof createSkillBar>[0];
const make = () => {
  const shown = vi.fn();
  return { bar: createSkillBar(call, clock, shown), shown };
};
const settleAll = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  backend = st({ state: "idle", names: [] });
  calls = [];
});
afterEach(() => vi.useRealTimers());

test("a started update shows at once, keeps polling with nothing else open, and ends in a green check that fades after 4 seconds", async () => {
  const { bar } = make();
  backend = st({ state: "running", names: ["a", "b"], code: null });
  bar.begin(["a", "b"]);
  expect(bar.get().item).toMatchObject({ tone: "info", text: "Updating 2 skills" });
  await settleAll(POLL_MS * 3);
  expect(calls.filter((c) => c === "skills_update_status").length).toBeGreaterThanOrEqual(3);
  expect(bar.get().item?.text).toBe("Updating 2 skills");

  backend = st({ results: [{ name: "a", ok: true, reason: null }, { name: "b", ok: true, reason: null }] });
  await settleAll(POLL_MS);
  expect(bar.get().item).toMatchObject({ tone: "ok", text: "Updated 2 skills" });
  const polls = calls.length;
  await settleAll(POLL_MS * 4);
  expect(calls.length).toBe(polls); // polling stopped at done
  await settleAll(FADE_MS);
  expect(bar.get().item).toBeNull();
});

test("a failure stays through any wait; the click clears it, asks for the dialog and clears the app's own record", async () => {
  const { bar, shown } = make();
  backend = st({ state: "running", code: null });
  bar.begin(["a", "b"]);
  backend = st({ results: [{ name: "a", ok: false, reason: "x" }, { name: "b", ok: false, reason: "x" }] });
  await settleAll(POLL_MS);
  expect(bar.get().item).toMatchObject({ tone: "bad" });
  await settleAll(10 * 60_000);
  expect(bar.get().item).toMatchObject({ tone: "bad" });
  bar.click();
  expect(shown).toHaveBeenCalledTimes(1);
  expect(bar.get().item).toBeNull();
  expect(calls).toContain("skills_update_clear");
  expect(bar.lastStatus()?.results).toHaveLength(2); // the dialog can still show what happened
  expect(bar.takeWanted()).toBe(true);
  expect(bar.takeWanted()).toBe(false);
});

test("a success is held while the dialog is open and fades 4 seconds after it closes", async () => {
  const { bar } = make();
  backend = st({ state: "running", code: null });
  bar.begin(["a", "b"]);
  bar.reading(true);
  backend = st({ results: [{ name: "a", ok: true, reason: null }, { name: "b", ok: true, reason: null }] });
  await settleAll(POLL_MS);
  await settleAll(FADE_MS * 5);
  expect(bar.get().item).toMatchObject({ tone: "ok" });
  bar.reading(false);
  await settleAll(FADE_MS - 1);
  expect(bar.get().item).not.toBeNull();
  await settleAll(1);
  expect(bar.get().item).toBeNull();
});

test("a subscriber hears each change, the Skills page picks up a run that was already going, and an idle app shows nothing", async () => {
  const { bar } = make();
  const heard = vi.fn();
  const off = bar.subscribe(heard);
  bar.sync();
  await settleAll(1);
  expect(bar.get().item).toBeNull();
  backend = st({ state: "running", names: ["a"], code: null });
  bar.sync();
  await settleAll(1);
  expect(bar.get().item?.text).toBe("Updating 1 skill");
  expect(heard).toHaveBeenCalled();
  off();
  const n = heard.mock.calls.length;
  backend = st({ results: [{ name: "a", ok: true, reason: null }] });
  await settleAll(POLL_MS);
  expect(heard.mock.calls.length).toBe(n);
  bar.dispose();
});

test("a stopping run shows stopping, then a stopped run reads as a failure", async () => {
  const { bar } = make();
  backend = st({ state: "running", code: null });
  bar.begin(["a", "b"]);
  backend = st({ state: "stopping", code: null });
  await settleAll(POLL_MS);
  expect(bar.get().item?.text).toBe("Stopping the skill update");
  backend = st({ stopped: true, code: null, results: [{ name: "a", ok: false, reason: "Stopped before it finished" }, { name: "b", ok: false, reason: "Stopped before it finished" }] });
  await settleAll(POLL_MS);
  expect(bar.get().item).toMatchObject({ tone: "bad" });
});

// UX audit skills-automations.md:6: a status read that keeps failing used to leave "Updating N skills" spinning for ever.
test("a progress read that keeps failing ends the run as failed with a reason, after a few tries", async () => {
  let reads = 0;
  const broken = (<T>(cmd: string): Promise<T> => {
    if (cmd === "skills_update_status") {
      reads++;
      return Promise.reject(new Error("backend gone"));
    }
    return Promise.resolve(undefined as T);
  }) as Parameters<typeof createSkillBar>[0];
  const bar = createSkillBar(broken, clock, vi.fn());
  bar.begin(["a", "b"]);
  expect(bar.get().item).toMatchObject({ tone: "info", text: "Updating 2 skills" });
  await settleAll(POLL_MS * (MAX_POLL_FAILS + 2));
  expect(reads).toBe(MAX_POLL_FAILS); // tried again, then gave up and stopped asking
  expect(bar.get().item).toMatchObject({ tone: "bad", text: "Skill update failed" });
  expect(bar.lastStatus()).toMatchObject({ state: "done", error: POLL_FAILED });
  await settleAll(POLL_MS * 10);
  expect(reads).toBe(MAX_POLL_FAILS);
});

// A fake app whose progress reads answer from a script: "fail" rejects, a status resolves, and once the script runs out it keeps saying "running".
const scripted = (script: Array<"fail" | UpdateStatus>) => {
  const reads = { n: 0 };
  const app = (<T>(cmd: string): Promise<T> => {
    if (cmd !== "skills_update_status") return Promise.resolve(undefined as T);
    const next = script[reads.n++] ?? st({ state: "running", code: null });
    return next === "fail" ? Promise.reject(new Error("blip")) : Promise.resolve(next as T);
  }) as Parameters<typeof createSkillBar>[0];
  return { reads, bar: createSkillBar(app, clock, vi.fn()) };
};

test("one failed progress read in the middle of a run is tried again and the run goes on to its real end", async () => {
  const { reads, bar } = scripted(["fail", st({ state: "running", code: null }), st({ results: [{ name: "a", ok: true, reason: null }, { name: "b", ok: true, reason: null }] })]);
  bar.begin(["a", "b"]);
  await settleAll(POLL_MS * 4);
  expect(reads.n).toBe(3); // the failed read was tried again, then the run was followed to its end, then reading stopped
  expect(bar.lastStatus()).toMatchObject({ state: "done", error: null });
  expect(bar.get().item).toMatchObject({ tone: "ok", text: "Updated 2 skills" });
  bar.dispose();
});

test("failures that are not in a row do not add up: fail, ok, fail, fail is still running", async () => {
  const { reads, bar } = scripted(["fail", st({ state: "running", code: null }), "fail", "fail"]);
  bar.begin(["a", "b"]);
  await settleAll(POLL_MS * 3); // reads 1 to 4 have happened (the first at once)
  expect(reads.n).toBe(4);
  expect(bar.get().item).toMatchObject({ tone: "info", text: "Updating 2 skills" });
  await settleAll(POLL_MS * 3); // and it keeps asking
  expect(reads.n).toBeGreaterThan(4);
  expect(bar.lastStatus()).toMatchObject({ state: "running", error: null });
  bar.dispose();
});

test("starting an update again while a progress read is in flight leaves one poll chain, not two", async () => {
  const waiting: Array<(s: UpdateStatus) => void> = [];
  let reads = 0;
  let live = false; // before the first read comes back, reads wait; after, they answer at once
  const app = (<T>(cmd: string): Promise<T> => {
    if (cmd !== "skills_update_status") return Promise.resolve(undefined as T);
    reads++;
    const running = st({ state: "running", code: null });
    return live ? Promise.resolve(running as T) : new Promise<T>((res) => waiting.push(res as (s: UpdateStatus) => void));
  }) as Parameters<typeof createSkillBar>[0];
  const bar = createSkillBar(app, clock, vi.fn());
  bar.begin(["a", "b"]); // read 1 in flight
  bar.begin(["a", "b"]); // a new run: read 2 in flight, read 1 is now stale
  expect(reads).toBe(2);
  live = true;
  waiting.forEach((res) => res(st({ state: "running", code: null }))); // the stale read comes back first and must be ignored
  await settleAll(POLL_MS * 3);
  expect(reads).toBe(2 + 3); // one chain: one read per half second, not two
  bar.dispose();
});
