// START-03 (board test, hash-locked): a pane's conversation id is saved only once the conversation
// really exists: on a hook event that is not a session boundary (the first UserPromptSubmit, a Stop,
// a tool step), never on SessionStart alone. A pane restored with an id taken from a bare SessionStart
// resumes a conversation Claude never wrote down and fails on every start.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { claimFrom, claimable } from "./sessionClaim";
import statusRaw from "./useAgentStatus.ts?raw";

type Seat = { key: number; session?: string; cwd: string | null; branch: string | null; agent: string; program: string | null; args: string[] };
const seat = (key: number, session?: string): Seat => ({ key, cwd: null, branch: null, agent: "claude", program: null, args: [], ...(session ? { session } : {}) });

// The hook reports as the Rust side sends them (hooks.rs claude_change / codex_change):
// SessionStart (startup, resume, clear) and a manual compact are boundaries; the rest are not.
const sessionStart = (paneKey: number, session: string, fresh = true) => ({ paneKey, state: "done", boundary: true, fresh, session });
const promptSubmit = (paneKey: number, session: string) => ({ paneKey, state: "working", boundary: false, session });
const stop = (paneKey: number, session: string) => ({ paneKey, state: "done", session }); // no boundary field at all

describe("claimable", () => {
  test("a boundary event never names a claimable id", () => {
    expect(claimable(sessionStart(1, "s-1"))).toBeNull();
    expect(claimable(sessionStart(1, "s-1", false))).toBeNull(); // a /clear
    expect(claimable({ paneKey: 1, boundary: true, session: "s-1" })).toBeNull();
  });

  test("a prompt or a stop names its id", () => {
    expect(claimable(promptSubmit(1, "s-1"))).toBe("s-1");
    expect(claimable(stop(1, "s-2"))).toBe("s-2");
    expect(claimable({ paneKey: 3, boundary: false, session: " s-3 " })).toBe("s-3");
  });

  test("no id, an empty id or a blank id claims nothing", () => {
    expect(claimable({ paneKey: 1, boundary: false })).toBeNull();
    expect(claimable({ paneKey: 1, boundary: false, session: "" })).toBeNull();
    expect(claimable({ paneKey: 1, boundary: false, session: "   " })).toBeNull();
  });
});

describe("claimFrom", () => {
  test("SessionStart alone never claims", () => {
    const panes = [seat(1), seat(2)];
    expect(claimFrom(panes, sessionStart(1, "s-1"))).toBe(panes);
    expect(claimFrom(panes, sessionStart(1, "s-1", false))).toBe(panes);
  });

  test("the first UserPromptSubmit claims", () => {
    const panes = [seat(1), seat(2)];
    const out = claimFrom(claimFrom(panes, sessionStart(1, "s-1")), promptSubmit(1, "s-1"));
    expect(out[0].session).toBe("s-1");
    expect(out[1]).toBe(panes[1]);
  });

  test("a Stop claims", () => {
    const out = claimFrom([seat(1)], stop(1, "s-9"));
    expect(out[0].session).toBe("s-9");
  });

  test("a changed id after /clear or a resume replaces the old one only once the new conversation runs", () => {
    let panes = [seat(1, "s-old")];
    panes = claimFrom(panes, sessionStart(1, "s-new", false)); // /clear: Claude names a new id at once
    expect(panes[0].session).toBe("s-old");
    panes = claimFrom(panes, sessionStart(1, "s-new2", true)); // a resume into another conversation
    expect(panes[0].session).toBe("s-old");
    panes = claimFrom(panes, promptSubmit(1, "s-new2"));
    expect(panes[0].session).toBe("s-new2");
  });

  test("an event for another pane changes only that pane; an unknown pane changes nothing", () => {
    const panes = [seat(1, "s-1"), seat(2)];
    const out = claimFrom(panes, promptSubmit(2, "s-2"));
    expect(out[0]).toBe(panes[0]);
    expect(out[1].session).toBe("s-2");
    expect(claimFrom(panes, promptSubmit(9, "s-9"))).toBe(panes);
  });

  test("the pane that claims an id takes it from any other pane (ACCT-063 kept)", () => {
    const out = claimFrom([seat(1), seat(2, "s-1")], promptSubmit(1, "s-1"));
    expect(out[0].session).toBe("s-1");
    expect(out[1].session).toBeUndefined();
  });
});

// The window's own wiring, driven through the real listener (the house harness from
// useAgentEvents.test.ts: a stand-in React and a caught event bus).
const refs: { current: unknown }[] = [];
const effs: { deps?: unknown[]; clean?: () => void }[] = [];
const due: (() => void)[] = [];
let ri = 0;
let ei = 0;
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useRef: (v: unknown) => (refs[ri] ??= { current: v }, refs[ri++]),
  useEffect: (f: () => void | (() => void), deps?: unknown[]) => {
    const i = ei++;
    const old = effs[i];
    if (old && deps && old.deps && deps.every((d, k) => d === old.deps?.[k])) return;
    due.push(() => {
      old?.clean?.();
      const c = f();
      effs[i] = { deps, clean: typeof c === "function" ? c : undefined };
    });
  },
}));
const bus: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, f: (e: { payload: unknown }) => void) => ((bus[name] = f), Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve() }));
const { useAgentEvents } = await import("./useAgentStatus");

let live: Seat[] = [];
const none = () => {};
const setPanes = (u: unknown) => {
  live = typeof u === "function" ? (u as (p: Seat[]) => Seat[])(live) : (u as Seat[]);
};
const render = (keys: number[]) => {
  ri = 0;
  ei = 0;
  live = keys.map((k) => seat(k));
  useAgentEvents({ panes: live as never, setPanes: setPanes as never, titles: {}, settings: {}, inView: () => true, setToast: none, tabName: () => "Claude 1", setCrew: none, setTurn: none, setStale: none, hookRef: { current: {} }, setHook: none, setStamp: none, setContext: none, unreadPanes: new Set(), setUnreadPanes: none, winFocused: false, markDir: none } as never);
  due.splice(0).forEach((f) => f());
};
const send = (p: Record<string, unknown>) => bus["agent-status"]({ payload: { interrupted: false, children: [], ...p } });

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
});

const code = (raw: string) =>
  raw
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1");

describe("START-03 wiring", () => {
  test("the status hook claims through claimFrom and no longer on every report", () => {
    const src = code(statusRaw);
    expect(src).toMatch(/import\s*\{[^}]*\bclaimFrom\b[^}]*\}\s*from\s*"\.\/sessionClaim"/);
    expect(src).toMatch(/claimFrom\(/);
    expect(src).not.toMatch(/claim\(\s*ps\s*,\s*paneKey\s*,\s*session\s*\)/);
  });

  test("through the real listener: SessionStart saves nothing, the first prompt saves the id", () => {
    render([1, 2]);
    send(sessionStart(1, "s-1"));
    expect(live.find((p) => p.key === 1)?.session).toBeUndefined();
    send(promptSubmit(1, "s-1"));
    expect(live.find((p) => p.key === 1)?.session).toBe("s-1");
    expect(live.find((p) => p.key === 2)?.session).toBeUndefined();
  });

  test("through the real listener: after /clear the new id waits for the next Stop", () => {
    render([3]);
    send(promptSubmit(3, "s-a"));
    send(sessionStart(3, "s-b", false));
    expect(live[0].session).toBe("s-a");
    send(stop(3, "s-b"));
    expect(live[0].session).toBe("s-b");
  });
});
