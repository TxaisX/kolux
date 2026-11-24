// LAG-09 (board test, locked): every pane used to make its own backend listen() call for each event kind it
// reads (terminal output, terminal exit, pane-agent, workspace-land): 3 to 4 IPC round trips per pane, so ten
// restored panes paid 30 to 40 before their terminals were live. These tests COUNT backend listen and unlisten
// calls with a fake listen; no clock is read.
import { describe, expect, it, vi } from "vitest";
import type { OutputEvent } from "./codec";
import { createListenHub } from "./listenHub";
import { EXIT_EVENT, OUTPUT_EVENT, listenShared, onTerminalExit, onTerminalOutput } from "./outputBus";
import { LAND_EVENT } from "./landState";

type Handler = (e: { payload: unknown }) => void;

// The fake backend the page's bus talks to: records every listen() and every unlisten, by event name.
const fake = vi.hoisted(() => {
  const state = {
    listens: [] as { event: string; handler: (e: { payload: unknown }) => void }[],
    unlistens: [] as string[],
    subscribes: 0,
  };
  return state;
});

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (b: unknown) => void = () => {};
  },
  invoke: vi.fn((cmd: string) => {
    if (cmd === "terminal_output_subscribe") fake.subscribes += 1;
    return Promise.resolve();
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: (e: { payload: unknown }) => void) => {
    fake.listens.push({ event, handler });
    return Promise.resolve(() => {
      fake.unlistens.push(event);
    });
  }),
}));

const count = (list: string[], event: string) => list.filter((e) => e === event).length;
const listensOf = (event: string) => count(fake.listens.map((l) => l.event), event);
const lastListen = (event: string) => {
  const all = fake.listens.filter((l) => l.event === event);
  if (all.length === 0) throw new Error(`no backend listen for ${event}`);
  return all[all.length - 1];
};
const chunk = (id: number, seq: number): OutputEvent => ({ id, data: "ZQ==", pane: id, generation: 1, seq });

// A fake injectable backend for the pure hub. `hold` keeps listen() pending until release(); `refuse` rejects.
function backend() {
  const calls: { event: string; handler: Handler }[] = [];
  const offs: string[] = [];
  let hold = false;
  let refuse = 0;
  const waiting: (() => void)[] = [];
  const live = new Set<Handler>();
  const listen = (event: string, handler: Handler): Promise<() => void> => {
    calls.push({ event, handler });
    const off = () => {
      offs.push(event);
      live.delete(handler);
    };
    if (refuse > 0) {
      refuse -= 1;
      return Promise.reject(new Error("listen refused"));
    }
    live.add(handler);
    if (!hold) return Promise.resolve(off);
    return new Promise((resolve) => waiting.push(() => resolve(off)));
  };
  const emit = (event: string, payload: unknown) => {
    // Like the real backend: only listeners that were granted and not yet removed hear an event.
    for (const c of calls.filter((c) => c.event === event && live.has(c.handler))) c.handler({ payload });
  };
  return {
    listen,
    calls,
    offs,
    emit,
    holdNext: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      waiting.splice(0).forEach((r) => r());
    },
    refuseNext: (n: number) => {
      refuse = n;
    },
  };
}

describe("LAG-09 shared listeners", () => {
  it("ten panes reading output and exits make one backend listen per event kind, not one per pane", async () => {
    for (const panes of [1, 10]) {
      const before = { out: listensOf(OUTPUT_EVENT), exit: listensOf(EXIT_EVENT), unl: fake.unlistens.length };
      const seen = new Array(panes).fill(0);
      const offs: (() => void)[] = [];
      for (let p = 0; p < panes; p++) {
        offs.push(await onTerminalOutput(() => (seen[p] += 1)));
        offs.push(await onTerminalExit(() => {}));
      }
      // Bound: one listen per event kind for the whole page, whatever the number of panes (today: one per pane).
      expect(listensOf(OUTPUT_EVENT) - before.out, `${panes} panes: terminal-output listens`).toBe(1);
      expect(listensOf(EXIT_EVENT) - before.exit, `${panes} panes: terminal-exit listens`).toBe(1);
      // One event on the shared listener still reaches every pane's reader exactly once.
      const shared = lastListen(OUTPUT_EVENT);
      shared.handler({ payload: { items: [chunk(3, 1)] } });
      expect(seen).toEqual(new Array(panes).fill(1));
      offs.forEach((off) => off());
      expect(fake.unlistens.length - before.unl, `${panes} panes: unlistens once all left`).toBe(2);
    }
    expect(fake.subscribes).toBeLessThanOrEqual(1);
  });

  it("ten panes reading pane-agent and workspace-land through listenShared make one backend listen each", async () => {
    for (const panes of [1, 10]) {
      const before = { agent: listensOf("pane-agent"), land: listensOf(LAND_EVENT), unl: fake.unlistens.length };
      const got: unknown[][] = [];
      const offs: (() => void)[] = [];
      for (let p = 0; p < panes; p++) {
        got.push([]);
        offs.push(await listenShared<{ terminal: number }>("pane-agent", (e) => got[p].push(e.payload)));
        offs.push(await listenShared(LAND_EVENT, () => {}));
      }
      expect(listensOf("pane-agent") - before.agent, `${panes} panes: pane-agent listens`).toBe(1);
      expect(listensOf(LAND_EVENT) - before.land, `${panes} panes: workspace-land listens`).toBe(1);
      const shared = lastListen("pane-agent");
      shared.handler({ payload: { terminal: 4 } });
      expect(got).toEqual(new Array(panes).fill(0).map(() => [{ terminal: 4 }]));
      offs.forEach((off) => off());
      expect(fake.unlistens.length - before.unl, `${panes} panes: unlistens once all left`).toBe(2);
    }
  });

  it("the last pane leaving removes the shared listener, not before, and a pane mounting later listens again", async () => {
    const base = { listens: listensOf(OUTPUT_EVENT), unl: count(fake.unlistens, OUTPUT_EVENT) };
    const a = await onTerminalOutput(() => {});
    const b = await onTerminalOutput(() => {});
    const c = await onTerminalOutput(() => {});
    a();
    b();
    expect(count(fake.unlistens, OUTPUT_EVENT) - base.unl, "two of three left: the listener stays").toBe(0);
    b(); // a second call of the same off does nothing
    expect(count(fake.unlistens, OUTPUT_EVENT) - base.unl).toBe(0);
    c();
    expect(count(fake.unlistens, OUTPUT_EVENT) - base.unl, "the last one left: one unlisten").toBe(1);
    c();
    expect(count(fake.unlistens, OUTPUT_EVENT) - base.unl, "off twice: still one unlisten").toBe(1);
    const d = await onTerminalOutput(() => {});
    expect(listensOf(OUTPUT_EVENT) - base.listens, "a pane after all left listens again").toBe(2);
    d();
    expect(count(fake.unlistens, OUTPUT_EVENT) - base.unl).toBe(2);
  });
});

describe("listen hub", () => {
  it("twelve handlers on one event share one backend listen and each gets an event exactly once", async () => {
    const be = backend();
    const hub = createListenHub(be.listen);
    const calls = new Array(12).fill(0);
    const offs: (() => void)[] = [];
    for (let i = 0; i < 12; i++) offs.push(await hub.on<number>("pane-agent", (e) => (calls[i] += e.payload)));
    expect(be.calls.length).toBe(1);
    expect(hub.handlers("pane-agent")).toBe(12);
    be.emit("pane-agent", 1);
    expect(calls).toEqual(new Array(12).fill(1));
    offs.slice(0, 11).forEach((off) => off());
    expect(be.offs).toEqual([]);
    expect(hub.handlers("pane-agent")).toBe(1);
    offs[11]();
    expect(be.offs).toEqual(["pane-agent"]);
    expect(hub.handlers("pane-agent")).toBe(0);
  });

  it("different event kinds get separate backend listeners and never see each other's events", async () => {
    const be = backend();
    const hub = createListenHub(be.listen);
    const a: unknown[] = [];
    const b: unknown[] = [];
    const offA = await hub.on("kind-a", (e) => a.push(e.payload));
    const offB = await hub.on("kind-b", (e) => b.push(e.payload));
    expect(be.calls.map((c) => c.event)).toEqual(["kind-a", "kind-b"]);
    be.emit("kind-a", "x");
    expect(a).toEqual(["x"]);
    expect(b).toEqual([]);
    offA();
    expect(be.offs).toEqual(["kind-a"]);
    offB();
    expect(be.offs).toEqual(["kind-a", "kind-b"]);
  });

  it("registrations made while the backend listen is pending share it and all resolve", async () => {
    const be = backend();
    const hub = createListenHub(be.listen);
    be.holdNext();
    const got: number[] = [];
    const pending = [0, 1, 2, 3, 4].map((i) => hub.on("terminal-exit", () => got.push(i)));
    expect(be.calls.length, "five registrations before the backend answered: one listen").toBe(1);
    be.release();
    const offs = await Promise.all(pending);
    be.emit("terminal-exit", null);
    expect(got).toEqual([0, 1, 2, 3, 4]);
    offs.forEach((off) => off());
    expect(be.offs).toEqual(["terminal-exit"]);
  });

  it("a handler added or removed during a delivery is neither lost nor delivered twice", async () => {
    const be = backend();
    const hub = createListenHub(be.listen);
    const log: string[] = [];
    let offB: () => void = () => {};
    let offC: (() => void) | null = null;
    const late: Promise<() => void>[] = [];
    const offA = await hub.on<number>("ev", (e) => {
      log.push(`a${e.payload}`);
      if (e.payload === 1) {
        offB(); // B comes after A: removed before its turn, it does not get this event
        late.push(hub.on<number>("ev", (e2) => log.push(`c${e2.payload}`))); // C joins: it gets the next event, not this one
      }
    });
    offB = await hub.on<number>("ev", (e) => log.push(`b${e.payload}`));
    const offD = await hub.on<number>("ev", (e) => log.push(`d${e.payload}`));
    be.emit("ev", 1);
    offC = await late[0];
    be.emit("ev", 2);
    expect(log).toEqual(["a1", "d1", "a2", "d2", "c2"]);
    expect(be.calls.length).toBe(1);
    offA();
    offD();
    offC();
    expect(be.offs).toEqual(["ev"]);
  });

  it("a handler that throws does not stop the others, and the same function twice is two registrations", async () => {
    const be = backend();
    const hub = createListenHub(be.listen);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const same = () => {
      n += 1;
    };
    const off1 = await hub.on("ev", same);
    const offBad = await hub.on("ev", () => {
      throw new Error("bad handler");
    });
    const off2 = await hub.on("ev", same);
    be.emit("ev", 0);
    expect(n).toBe(2);
    off1();
    be.emit("ev", 0);
    expect(n).toBe(3);
    off2();
    offBad();
    expect(be.offs).toEqual(["ev"]);
    quiet.mockRestore();
  });

  it("a refused backend listen rejects every waiting registration and the next registration tries again", async () => {
    const be = backend();
    const hub = createListenHub(be.listen);
    be.refuseNext(1);
    const first = hub.on("ev", () => {});
    const second = hub.on("ev", () => {});
    const settled = await Promise.allSettled([first, second]);
    expect(settled.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    for (const r of settled) if (r.status === "rejected") expect(String(r.reason)).toContain("listen refused");
    expect(be.calls.length).toBe(1);
    expect(hub.handlers("ev")).toBe(0);
    let got = 0;
    const off = await hub.on("ev", () => (got += 1));
    expect(be.calls.length, "after a refusal the next registration listens again").toBe(2);
    be.emit("ev", 0);
    expect(got).toBe(1);
    off();
    expect(be.offs).toEqual(["ev"]);
  });
});
