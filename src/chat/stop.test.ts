// CHAT-018 (T-329): Stop interrupts the agent. The button's modes and double-click guard (stop.ts), and
// stopPane (send.ts): a send still waiting is cancelled before Escape goes out; Escape never goes into a menu.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as stop from "./stop";
import { STOP_ARM_MS, buttonMode, stopArmed } from "./stop";
import { CANCELLED_NOTE, INTERRUPT_KEY, boxSend, forgetHearing, hearStates, setClock, sendToPane, stopPane } from "./send";

type Handler = (e: { payload: unknown }) => void;
const handlers: Handler[] = [];
const listen = async (_n: string, h: Handler) => {
  handlers.push(h);
  return () => {};
};
const emit = (p: unknown) => handlers.forEach((h) => h({ payload: p }));
const writes: { id: number; data: string }[] = [];
const write = async (id: number, data: string) => void writes.push({ id, data });
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
beforeEach(async () => {
  writes.length = 0;
  handlers.length = 0;
  setClock(() => 0);
  await hearStates(listen as never);
});
afterEach(() => forgetHearing());

describe("the Send / Stop button", () => {
  it("reads Stop while the agent works, and Send when it is idle or asking", () => {
    expect(buttonMode(true, false)).toBe("stop");
    expect(buttonMode(false, false)).toBe("send");
    expect(buttonMode(true, true)).toBe("send");
  });
  it("a Stop within 700 ms of a send from the box is the second click of a double-click and does nothing", () => {
    expect(STOP_ARM_MS).toBe(700);
    expect(stopArmed(1000, 1000)).toBe(false);
    expect(stopArmed(1000, 1699)).toBe(false);
    expect(stopArmed(1000, 1700)).toBe(true);
    expect(stopArmed(null, 0)).toBe(true);
  });
  // Live check 6: Stop pressed 50 to 600 ms after a message sent with Enter was swallowed by the guard,
  // so the engine was never asked and the reply ran to its end.
  it("a Stop right after a send from the keyboard counts at once: only a click on Send starts the guard", () => {
    const sentByEnter = stop.guardedFrom("key", 1000);
    expect(sentByEnter).toBeNull();
    for (const ms of [0, 50, 200, 300, 600]) expect(stopArmed(sentByEnter, 1000 + ms)).toBe(true);
    const sentByClick = stop.guardedFrom("click", 1000);
    expect(stopArmed(sentByClick, 1300)).toBe(false);
    expect(stopArmed(sentByClick, 1700)).toBe(true);
  });
});

describe("stopPane", () => {
  const deps = (state: string | undefined, terminal: number | null = 70) => ({ terminalOf: () => terminal ?? undefined, stateOf: () => state, write });

  it("types Escape into the pane's terminal", async () => {
    emit({ paneKey: 1, state: "working", terminal: 70 });
    expect(await stopPane(1, deps("working"))).toBe("stopped");
    expect(writes).toEqual([{ id: 70, data: INTERRUPT_KEY }]);
    expect(INTERRUPT_KEY).toBe("\x1b");
  });
  it("types nothing while the agent asks in its terminal: Escape there would answer the question", async () => {
    emit({ paneKey: 1, state: "permission", terminal: 70 });
    expect(await stopPane(1, deps("permission"))).toBe("asking");
    expect(await stopPane(1, deps("working"))).toBe("asking");
    expect(writes).toEqual([]);
  });
  it("says so when the pane has no terminal", async () => {
    expect(await stopPane(1, deps("working", null))).toBe("no-terminal");
    expect(writes).toEqual([]);
  });
  it("cancels a send that is waiting in the queue before the interrupt goes out: its Enter is never typed", async () => {
    emit({ paneKey: 1, state: "working", terminal: 70 });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    // the first send is mid-way (waiting between its writes); the second waits behind it in the queue
    const slow = async (ms: number) => void (ms > 0 && (await gate));
    const d = { terminalOf: () => 70, stateOf: () => "working", write, sleep: slow };
    const first = sendToPane(1, "claude", "first", d);
    await flush();
    const second = sendToPane(1, "claude", "second", { ...d, sleep: async () => {} });
    await flush();
    const stopped = stopPane(1, { terminalOf: () => 70, stateOf: () => "working", write });
    release();
    expect(await first).toBe("cancelled");
    expect(await second).toBe("cancelled");
    expect(await stopped).toBe("stopped");
    // only the first send's line-clear and paste went in (before Stop), then Escape; no Enter, nothing of "second"
    expect(writes.some((w) => w.data === "\r")).toBe(false);
    expect(writes.some((w) => w.data.includes("second"))).toBe(false);
    expect(writes[writes.length - 1]).toEqual({ id: 70, data: INTERRUPT_KEY });
  });
  it("a send made after Stop goes through normally", async () => {
    emit({ paneKey: 1, state: "working", terminal: 70 });
    await stopPane(1, deps("working"));
    expect(await sendToPane(1, "claude", "again", { ...deps("working"), sleep: async () => {} })).toBe("sent");
  });
});

describe("a cancelled box send", () => {
  it("drops its waiting row and says Stop cancelled it, instead of marking it failed", async () => {
    emit({ paneKey: 1, state: "working", terminal: 70 });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const notes: (string | null)[] = [];
    let cancelled = 0;
    let failed = 0;
    const d = { terminalOf: () => 70, stateOf: () => "working", write, sleep: async (ms: number) => void (ms > 0 && (await gate)) };
    expect(boxSend(1, "claude", "hello", d, { note: (n) => notes.push(n), onQueued: () => {}, onFailed: () => void failed++, onCancelled: () => void cancelled++ })).toBe(true);
    await flush();
    const stopped = stopPane(1, { terminalOf: () => 70, stateOf: () => "working", write });
    release();
    await stopped;
    await flush();
    expect(cancelled).toBe(1);
    expect(failed).toBe(0);
    expect(notes[notes.length - 1]).toBe(CANCELLED_NOTE);
  });
});

// FIX-1 (stand-in review of f1ad80d5, item 2): the "asking" check is repeated inside the queued job, and a send that is
// waiting out a tool gives up as soon as Stop is pressed.
describe("FIX-1: Stop while a send waits out a tool", () => {
  it("a prompt that appears during the wait gets no Escape: Stop says the agent is asking", async () => {
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    let state = "working";
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const d = { terminalOf: () => 70, stateOf: () => state, write, sleep: async (ms: number) => void (ms > 0 && (await gate)) };
    const first = sendToPane(1, "claude", "first", d);
    await flush(); // the send is in its tool wait
    const stopped = stopPane(1, d); // the check before the queue passes: the agent is working
    await flush();
    state = "permission";
    emit({ paneKey: 1, state: "permission", tool: "Bash", terminal: 70 });
    release();
    expect(await first).toBe("cancelled");
    expect(await stopped).toBe("asking");
    expect(writes).toEqual([]);
  });
  it("the same when only the window's own reading flips, not the chat's", async () => {
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    let state = "working";
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const d = { terminalOf: () => 70, stateOf: () => state, write, sleep: async (ms: number) => void (ms > 0 && (await gate)) };
    const first = sendToPane(1, "claude", "first", d);
    await flush();
    const stopped = stopPane(1, d);
    await flush();
    state = "waiting";
    release();
    await first;
    expect(await stopped).toBe("asking");
    expect(writes).toEqual([]);
  });
  it("a send in its tool wait gives up when Stop is pressed instead of sleeping through the whole limit", async () => {
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 }); // clock stays at 0: the tool is always "just started"
    let sleeps = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const sleep = async (ms: number) => {
      sleeps++;
      if (sleeps === 1 && ms > 0) await gate;
    };
    const d = { terminalOf: () => 70, stateOf: () => "working", write, sleep };
    const first = sendToPane(1, "claude", "first", d);
    await flush();
    const stopped = stopPane(1, d);
    await flush();
    release();
    expect(await first).toBe("cancelled");
    expect(await stopped).toBe("stopped");
    expect(sleeps).toBe(1);
    expect(writes).toEqual([{ id: 70, data: INTERRUPT_KEY }]);
  });
  it("with no prompt anywhere Stop still types Escape after a send that was waiting", async () => {
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const d = { terminalOf: () => 70, stateOf: () => "working", write, sleep: async (ms: number) => void (ms > 0 && (await gate)) };
    const first = sendToPane(1, "claude", "first", d);
    await flush();
    const stopped = stopPane(1, d);
    release();
    await first;
    expect(await stopped).toBe("stopped");
    expect(writes).toEqual([{ id: 70, data: INTERRUPT_KEY }]);
  });
});

// FIX-2 (stand-in review of 47de0346, item 8): like a card click, Stop looks at the pane's terminal again when its turn
// in the terminal's queue comes; after a restart the Escape must not go to the old (dead) session or the new one.
describe("FIX-2: Stop checks the terminal again at its turn", () => {
  it("types nothing when the pane's terminal changed while the interrupt waited in the queue", async () => {
    let terminal: number | undefined = 70;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { enqueue } = await import("./composer");
    void enqueue(70, () => gate);
    const stop = stopPane(1, { terminalOf: () => terminal, stateOf: () => "working", write });
    await flush();
    terminal = 71; // the program was started again
    release();
    expect(await stop).toBe("no-terminal");
    expect(writes).toEqual([]);
  });
  it("types nothing when the pane has no terminal any more at its turn", async () => {
    let terminal: number | undefined = 70;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { enqueue } = await import("./composer");
    void enqueue(70, () => gate);
    const stop = stopPane(1, { terminalOf: () => terminal, stateOf: () => "working", write });
    await flush();
    terminal = undefined;
    release();
    expect(await stop).toBe("no-terminal");
    expect(writes).toEqual([]);
  });
  it("still types Escape when the terminal is the same at its turn", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { enqueue } = await import("./composer");
    void enqueue(70, () => gate);
    const stop = stopPane(1, { terminalOf: () => 70, stateOf: () => "working", write });
    await flush();
    release();
    expect(await stop).toBe("stopped");
    expect(writes).toEqual([{ id: 70, data: INTERRUPT_KEY }]);
  });
});
