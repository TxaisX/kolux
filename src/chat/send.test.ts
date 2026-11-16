// Council FIX-1 (re-review of a969502): sendToPane, the send path under the chat box, with a stand-in
// for Tauri's invoke (terminal_write) and for listen (the agent-status hook events). The box's own
// Enter (boxSend, which ChatView.send runs) is in box.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { LIMIT } from "../terminal/paste";
import { ASKING_NOTE } from "./composer";
import { UNSEEN_NOTE, forgetHearing, hearStates, heardOf, holdNote, sendToPane } from "./send";

type Status = { paneKey: number; state?: string };
type Handler = (e: { payload: Status }) => void;

/** A stand-in for listen("agent-status"): `emit` delivers one hook event to every listener. */
function fakeListen() {
  const handlers: Handler[] = [];
  const listen = (_name: string, h: Handler) => {
    handlers.push(h);
    return Promise.resolve(() => {});
  };
  return { listen, emit: (p: Status) => handlers.forEach((h) => h({ payload: p })) };
}

/** A stand-in for invoke("terminal_write"): records each write by terminal; `onWrite` runs after it lands. */
function fakeInvoke(onWrite: (id: number, data: string) => void = () => {}) {
  const writes: { id: number; data: string }[] = [];
  const invoke = async (cmd: string, args: { id: number; data: string }) => {
    expect(cmd).toBe("terminal_write");
    writes.push(args);
    onWrite(args.id, args.data);
  };
  return { writes, write: (id: number, data: string) => invoke("terminal_write", { id, data }) };
}

const fast = () => Promise.resolve();
afterEach(() => forgetHearing());

describe("the chat sends only when it can see the agent is not asking (council FB1)", () => {
  it("an unknown state holds the box with its own note: hooks off, Codex trust failed, OpenClaude, first mount", () => {
    expect(holdNote(undefined, undefined)).toBe(UNSEEN_NOTE);
    expect(UNSEEN_NOTE).toBe("Kolux can't see this agent's questions. Type in its terminal.");
    expect(holdNote("some-new-word", undefined)).toBe(UNSEEN_NOTE);
  });

  it("a permission or question menu holds it with the asking note, whichever reading has it", () => {
    expect(holdNote("permission", undefined)).toBe(ASKING_NOTE);
    expect(holdNote(undefined, "waiting")).toBe(ASKING_NOTE);
    expect(holdNote("working", "permission")).toBe(ASKING_NOTE);
  });

  it("a known clear state lets it send", () => {
    for (const s of ["working", "queued", "done", "idle", "interrupted", "blocked"]) expect(holdNote(s, undefined)).toBeUndefined();
    expect(holdNote(undefined, "idle")).toBeUndefined();
  });

  it("with no hook reading at all, a send types nothing into the terminal", async () => {
    const { writes, write } = fakeInvoke();
    const got = await sendToPane(7, "claude", "no, stop", { terminalOf: () => 70, stateOf: () => undefined, write, sleep: fast });
    expect(got).toBe("held");
    expect(writes).toEqual([]);
  });
});

describe("a send's stop check reads the send's own pane (council FB2)", () => {
  it("a permission state already showing sends nothing", async () => {
    const { writes, write } = fakeInvoke();
    const got = await sendToPane(7, "claude", "go on", { terminalOf: () => 70, stateOf: () => "permission", write, sleep: fast });
    expect(got).toBe("held");
    expect(writes).toEqual([]);
  });

  it("a hook event mid-send drops the Enter", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    emit({ paneKey: 7, state: "working" });
    const { writes, write } = fakeInvoke((_id, data) => {
      if (data.includes("no, do not run that")) emit({ paneKey: 7, state: "permission" });
    });
    const got = await sendToPane(7, "claude", "no, do not run that", { terminalOf: () => 70, write, sleep: fast });
    expect(got).toBe("stopped");
    expect(writes.map((w) => w.data)).not.toContain("\r");
    expect(writes).toHaveLength(2);
  });

  it("a send keyed to pane A stops on A's menu while the window's other pane B stays clear", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    // The window's hook readings by pane: A (7) working, B (8) idle.
    const app: Record<number, string> = { 7: "working", 8: "idle" };
    const { writes, write } = fakeInvoke((_id, data) => {
      if (!data.includes("approve nothing")) return;
      // A opens its permission menu while the text is going in; B (8) is still idle.
      app[7] = "permission";
      emit({ paneKey: 7, state: "permission" });
    });
    const got = await sendToPane(7, "claude", "approve nothing", { terminalOf: () => 70, stateOf: (k) => app[k], write, sleep: fast });
    expect(app[8]).toBe("idle");
    expect(got).toBe("stopped");
    expect(writes.filter((w) => w.id === 70).map((w) => w.data)).not.toContain("\r");
  });

  it("the window's reading alone also stops it, when the event reached the window but not the chat", async () => {
    const app: Record<number, string> = { 7: "working" };
    const { writes, write } = fakeInvoke((_id, data) => {
      if (data.includes("keep going")) app[7] = "waiting";
    });
    expect(await sendToPane(7, "claude", "keep going", { terminalOf: () => 70, stateOf: (k) => app[k], write, sleep: fast })).toBe("stopped");
    expect(writes.map((w) => w.data)).not.toContain("\r");
  });

  it("the hook listener keeps every pane's reading, not only the pane on screen", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    await hearStates(listen);
    emit({ paneKey: 7, state: "permission" });
    emit({ paneKey: 8, state: "idle" });
    emit({ paneKey: 8 });
    expect(heardOf(7)).toBe("permission");
    expect(heardOf(8)).toBe("idle");
  });

  it("a clear pane gets the whole message and its Enter, into the terminal the pane has at send time", async () => {
    const { writes, write } = fakeInvoke();
    let pty: number | undefined = undefined;
    const deps = { terminalOf: () => pty, stateOf: () => "idle", write, sleep: fast };
    expect(await sendToPane(7, "claude", "hello", deps)).toBe("no-terminal");
    pty = 71;
    expect(await sendToPane(7, "claude", "hello", deps)).toBe("sent");
    expect(writes.map((w) => [w.id, w.data])).toEqual([
      [71, "\x15"],
      [71, "\x1b[200~hello\x1b[201~"],
      [71, "\r"],
    ]);
  });

  it("a message over the paste limit is not sent at all", async () => {
    const { writes, write } = fakeInvoke();
    expect(await sendToPane(7, "claude", "x".repeat(LIMIT + 1), { terminalOf: () => 70, stateOf: () => "idle", write, sleep: fast })).toBe("too-long");
    expect(writes).toEqual([]);
  });
});
