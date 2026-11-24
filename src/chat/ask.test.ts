// CHAT-023 (T-329): the permission card. Hook events (stand-ins) fold into a per-pane prompt record; the card
// shows while a named tool's prompt is open and not answered; Allow / Deny type the program's keys only while
// that prompt is still the one showing; a dismissed prompt stays dismissed until the next one.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answeredElsewhere, askOf, askTitle, answerCard, cardOf, dismissAsk, forgetAsks, hearAsks, subscribeAsk, takeAsk } from "./ask";
import { enqueue } from "./composer";
import { forgetHearing, hearStates, setClock } from "./send";

type Handler = (e: { payload: Record<string, unknown> }) => void;
const handlers: Handler[] = [];
const listen = async (_n: string, h: Handler) => {
  handlers.push(h);
  return () => {};
};
const emit = (p: Record<string, unknown>) => handlers.forEach((h) => h({ payload: p }));
const writes: { id: number; data: string }[] = [];
const deps = (terminal: number | null = 70) => ({ terminalOf: () => terminal ?? undefined, write: async (id: number, data: string) => void writes.push({ id, data }) });

beforeEach(async () => {
  writes.length = 0;
  handlers.length = 0;
  setClock(() => 0);
  await hearAsks(listen as never);
  await hearStates(listen as never);
});
afterEach(() => {
  forgetAsks();
  forgetHearing();
});

const ask = (extra: Record<string, unknown> = {}) => emit({ paneKey: 1, state: "permission", tool: "Bash", detail: "rm -rf build", terminal: 70, ...extra });

describe("the card", () => {
  it("shows Allow Bash? for a Claude shell command, with the command as detail", () => {
    ask();
    const card = cardOf("claude", askOf(1), 70);
    expect(card).toMatchObject({ tool: "Bash", detail: "rm -rf build", review: false });
    expect(askTitle("Bash")).toBe("Allow Bash?");
  });
  it("offers Review plan when the request is to leave plan mode", () => {
    ask({ tool: "ExitPlanMode", detail: undefined, plan: "# Plan\n1. do it" });
    expect(cardOf("claude", askOf(1), 70)?.review).toBe(true);
  });
  it("shows no card for a shell, another agent, an unnamed tool, another working state, or an event from another terminal", () => {
    ask();
    expect(cardOf("shell", askOf(1), 70)).toBeNull();
    expect(cardOf("opencode", askOf(1), 70)).toBeNull();
    expect(cardOf(undefined, askOf(1), 70)).toBeNull();
    expect(cardOf("claude", askOf(1), 71)).toBeNull();
    emit({ paneKey: 2, state: "permission", terminal: 80 });
    expect(cardOf("claude", askOf(2), 80)).toBeNull();
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    expect(cardOf("claude", askOf(1), 70)).toBeNull();
  });
  it("tracks separate approvals on their own: a second prompt after an answered one is a new card", async () => {
    ask();
    const first = cardOf("claude", askOf(1), 70)!;
    expect(await answerCard(1, "claude", "approve", first.drawnAt, deps())).toBe("sent");
    expect(cardOf("claude", askOf(1), 70)).toBeNull();
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    ask({ tool: "Write", detail: "a.txt" });
    const second = cardOf("claude", askOf(1), 70)!;
    expect(second.tool).toBe("Write");
    expect(second.drawnAt).toBe(first.drawnAt + 1);
  });
  it("a dismissed card stays dismissed, even when the hook repeats the same prompt", () => {
    ask();
    const card = cardOf("claude", askOf(1), 70)!;
    let pokes = 0;
    const off = subscribeAsk(() => void pokes++);
    dismissAsk(1, card.drawnAt);
    expect(pokes).toBe(1);
    ask();
    expect(cardOf("claude", askOf(1), 70)).toBeNull();
    off();
  });
  it("takeAsk keeps what the prompt told when the same prompt is reported again without it", () => {
    const a = takeAsk(undefined, { paneKey: 1, state: "permission", tool: "Bash", detail: "ls", terminal: 70 });
    const b = takeAsk(a, { paneKey: 1, state: "permission" });
    expect(b).toMatchObject({ count: 1, tool: "Bash", detail: "ls" });
    expect(takeAsk(b, { paneKey: 1 })).toBe(b);
  });
});

describe("Allow and Deny", () => {
  it("Claude: Allow types Enter (Yes is highlighted), Deny types Escape", async () => {
    ask();
    await answerCard(1, "claude", "approve", askOf(1)!.count, deps());
    expect(writes).toEqual([{ id: 70, data: "\r" }]);
    writes.length = 0;
    emit({ paneKey: 1, state: "working", terminal: 70 });
    ask({ tool: "Bash" });
    await answerCard(1, "claude", "deny", askOf(1)!.count, deps());
    expect(writes).toEqual([{ id: 70, data: "\x1b" }]);
  });
  it("Codex: Allow types y, Deny types n", async () => {
    ask();
    await answerCard(1, "codex", "approve", askOf(1)!.count, deps());
    emit({ paneKey: 1, state: "working", terminal: 70 });
    ask();
    await answerCard(1, "codex", "deny", askOf(1)!.count, deps());
    expect(writes.map((w) => w.data)).toEqual(["y", "n"]);
  });
  it("a stale click types nothing: the card was drawn for an earlier prompt, or the agent moved on", async () => {
    ask();
    const drawn = askOf(1)!.count;
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("gone");
    ask();
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("gone");
    expect(writes).toEqual([]);
  });
  it("a second click on the same card types nothing", async () => {
    ask();
    const drawn = askOf(1)!.count;
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("sent");
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("gone");
    expect(writes).toHaveLength(1);
  });
  it("types nothing when the pane's terminal is not the one the prompt came from, or there is none", async () => {
    ask();
    expect(await answerCard(1, "claude", "approve", askOf(1)!.count, deps(71))).toBe("gone");
    emit({ paneKey: 1, state: "working", terminal: 70 });
    ask();
    expect(await answerCard(1, "claude", "approve", askOf(1)!.count, deps(null))).toBe("no-terminal");
    expect(writes).toEqual([]);
  });
});

// FIX-1 (stand-in review of f1ad80d5, items 1, 3, 4): the card must follow what the terminal and the hook say.
describe("FIX-1: answered in the terminal", () => {
  it("a terminal-side answer hides the card, and a click already on its way types nothing", async () => {
    ask();
    const drawn = cardOf("claude", askOf(1), 70)!.drawnAt;
    let pokes = 0;
    const off = subscribeAsk(() => void pokes++);
    answeredElsewhere(1);
    expect(pokes).toBe(1);
    expect(cardOf("claude", askOf(1), 70)).toBeNull();
    expect(await answerCard(1, "claude", "approve", drawn, deps())).toBe("gone");
    expect(await answerCard(1, "claude", "deny", drawn, deps())).toBe("gone");
    expect(writes).toEqual([]);
    off();
  });
  it("the hook repeating the same prompt does not bring the card back, the next prompt does", () => {
    ask();
    answeredElsewhere(1);
    ask();
    expect(cardOf("claude", askOf(1), 70)).toBeNull();
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    ask({ tool: "Write", detail: "a.txt" });
    expect(cardOf("claude", askOf(1), 70)?.tool).toBe("Write");
  });
  it("a pane with no prompt record is left alone", () => {
    expect(() => answeredElsewhere(9)).not.toThrow();
    expect(askOf(9)).toBeUndefined();
  });
  it("a click waiting behind another write types nothing when the prompt is answered in the terminal meanwhile", async () => {
    ask();
    const drawn = askOf(1)!.count;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    void enqueue(70, () => gate); // something already in the terminal's queue
    const click = answerCard(1, "claude", "deny", drawn, deps());
    await new Promise((r) => setTimeout(r, 0));
    answeredElsewhere(1);
    release();
    expect(await click).toBe("gone");
    expect(writes).toEqual([]);
  });
  it("a click waiting behind another write types nothing when the agent moved on meanwhile", async () => {
    ask();
    const drawn = askOf(1)!.count;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    void enqueue(70, () => gate);
    const click = answerCard(1, "claude", "approve", drawn, deps());
    await new Promise((r) => setTimeout(r, 0));
    emit({ paneKey: 1, state: "working", tool: "Bash", terminal: 70 });
    release();
    expect(await click).toBe("gone");
    expect(writes).toEqual([]);
  });
  it("a click that is still the live prompt after the wait types its key", async () => {
    ask();
    const drawn = askOf(1)!.count;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    void enqueue(70, () => gate);
    const click = answerCard(1, "claude", "approve", drawn, deps());
    await new Promise((r) => setTimeout(r, 0));
    release();
    expect(await click).toBe("sent");
    expect(writes).toEqual([{ id: 70, data: "\r" }]);
  });
});

describe("FIX-1: a different tool or detail is a new prompt", () => {
  it("a permission event naming another tool counts a new prompt and starts clean", () => {
    const a = takeAsk(undefined, { paneKey: 1, state: "permission", tool: "Bash", detail: "rm -rf build", terminal: 70 });
    const b = takeAsk(a, { paneKey: 1, state: "permission", tool: "Edit", terminal: 70 });
    expect(b.count).toBe(a.count + 1);
    expect(b.tool).toBe("Edit");
    expect(b.detail).toBeUndefined();
  });
  it("another detail for the same tool is a new prompt too, and the plan and cut flag do not carry over", () => {
    const a = takeAsk(undefined, { paneKey: 1, state: "permission", tool: "Bash", detail: "ls", plan: "p", planCut: true, terminal: 70 });
    const b = takeAsk(a, { paneKey: 1, state: "permission", tool: "Bash", detail: "rm x", terminal: 70 });
    expect(b).toMatchObject({ count: a.count + 1, tool: "Bash", detail: "rm x" });
    expect(b.plan).toBeUndefined();
    expect(b.planCut).toBeUndefined();
  });
  it("naming the tool for the first time, or repeating the same one, is still the same prompt", () => {
    const a = takeAsk(undefined, { paneKey: 1, state: "permission", terminal: 70 });
    const b = takeAsk(a, { paneKey: 1, state: "permission", tool: "Bash", detail: "ls", terminal: 70 });
    const c = takeAsk(b, { paneKey: 1, state: "permission", tool: "Bash", detail: "ls", terminal: 70 });
    expect([a.count, b.count, c.count]).toEqual([1, 1, 1]);
  });
  it("a card drawn for the old tool is gone, and a click on it types nothing into the new prompt; the new prompt shows its own card", async () => {
    ask();
    const old = askOf(1)!.count;
    ask({ tool: "Edit", detail: undefined });
    expect(cardOf("claude", askOf(1), 70)).toMatchObject({ tool: "Edit", detail: undefined, drawnAt: old + 1 });
    expect(await answerCard(1, "claude", "approve", old, deps())).toBe("gone");
    expect(writes).toEqual([]);
  });
  it("a prompt answered in the terminal comes back as a card when the tool changes", () => {
    ask();
    answeredElsewhere(1);
    ask({ tool: "Edit", detail: "a.ts" });
    expect(cardOf("claude", askOf(1), 70)).toMatchObject({ tool: "Edit" });
  });
});

// FIX-2 (stand-in review of 47de0346, item 5): the window's own reading of the pane must still say "permission", so an
// answer given on a surface the card cannot hear (the board, the plan sheet) hides the card and a waiting click types nothing.
describe("FIX-2: the window's own reading must still be permission", () => {
  const withState = (get: () => string | undefined, terminal: number | null = 70) => ({ ...deps(terminal), stateOf: () => get() });
  it("no card once the window's reading has left permission, though the hook record still says permission", () => {
    ask();
    expect(cardOf("claude", askOf(1), 70, () => "working")).toBeNull();
    expect(cardOf("claude", askOf(1), 70, () => undefined)).toBeNull();
    expect(cardOf("claude", askOf(1), 70, () => "permission")).toMatchObject({ tool: "Bash" });
  });
  it("a window that gives no readings leaves the card as the hook record says", () => {
    ask();
    expect(cardOf("claude", askOf(1), 70)).toMatchObject({ tool: "Bash" });
  });
  it("a click types nothing when the window already reads working (answered on the board)", async () => {
    ask();
    const drawn = askOf(1)!.count;
    expect(await answerCard(1, "claude", "deny", drawn, withState(() => "working"))).toBe("gone");
    expect(writes).toEqual([]);
  });
  it("a click waiting behind another write types nothing when a board or plan-sheet answer moves the window to working meanwhile", async () => {
    ask();
    const drawn = askOf(1)!.count;
    let state = "permission";
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    void enqueue(70, () => gate);
    const click = answerCard(1, "claude", "deny", drawn, withState(() => state));
    await new Promise((r) => setTimeout(r, 0));
    state = "working"; // no agent-status event: App's answer() only moves the window's own reading
    release();
    expect(await click).toBe("gone");
    expect(writes).toEqual([]);
    expect(askOf(1)!.state).toBe("permission"); // the hook record never heard of it
  });
  it("a click whose window reading is still permission after the wait types its key", async () => {
    ask();
    const drawn = askOf(1)!.count;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    void enqueue(70, () => gate);
    const click = answerCard(1, "claude", "approve", drawn, withState(() => "permission"));
    await new Promise((r) => setTimeout(r, 0));
    release();
    expect(await click).toBe("sent");
    expect(writes).toEqual([{ id: 70, data: "\r" }]);
  });
  it("a card answered once cannot be answered again, and an expired one (the agent moved on) cannot either", async () => {
    ask();
    const drawn = askOf(1)!.count;
    let state = "permission";
    expect(await answerCard(1, "claude", "approve", drawn, withState(() => state))).toBe("sent");
    state = "working";
    expect(await answerCard(1, "claude", "approve", drawn, withState(() => state))).toBe("gone");
    expect(writes).toHaveLength(1);
  });
});

describe("row 1032: a prompt heard before the Agents screen first opens", () => {
  it("the window's start-up hearing counts it, so the chat's first mount draws the card", async () => {
    forgetAsks();
    forgetHearing();
    handlers.length = 0;
    await hearStates(listen as never); // the window, at start (App.tsx); no chat mounted yet
    ask();
    await hearAsks(listen as never); // the chat's first mount, after the event
    expect(cardOf("claude", askOf(1), 70)).toMatchObject({ tool: "Bash", detail: "rm -rf build" });
  });
});
