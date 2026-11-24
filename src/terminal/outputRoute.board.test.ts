// LAG-10 (board test, locked): every output chunk used to be handed to every registered reader (one per
// pane), each of which checked whether the chunk was its own. These tests COUNT how many readers a chunk is
// handed to, through the pure router and through the page bus's fanOut; no clock is read.
import { describe, expect, it, vi } from "vitest";
import type { OutputEvent } from "./codec";
import { createOutputRouter } from "./outputRouter";
import { fanOut, onTerminalOutput, onTerminalOutputRouted } from "./outputBus";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (b: unknown) => void = () => {};
  },
  invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const chunk = (id: number, seq: number): OutputEvent => ({ id, data: "ZQ==", pane: id, generation: 1, seq });

describe("LAG-10 routed output", () => {
  it("the router hands a chunk for terminal 5 to the one reader routed to 5, not to all 12", () => {
    const router = createOutputRouter<string>();
    for (let id = 1; id <= 12; id++) router.add(`r${id}`, id);
    expect(router.targets(5)).toEqual(["r5"]);
    expect(router.targets(99)).toEqual([]);
    router.add("u1", null);
    router.add("u2", null);
    expect(router.targets(5)).toEqual(["u1", "u2", "r5"]);
    router.add("r5", 6); // re-routed: no longer a target for 5, now one for 6 (after r6)
    expect(router.targets(5)).toEqual(["u1", "u2"]);
    expect(router.targets(6)).toEqual(["u1", "u2", "r6", "r5"]);
    router.add("r5", null); // unrouted again: gets every chunk, counted once
    expect(router.targets(6)).toEqual(["u1", "u2", "r5", "r6"]);
    router.remove("r5");
    router.remove("r5"); // removing twice is safe
    router.remove("u1");
    expect(router.targets(6)).toEqual(["u2", "r6"]);
    expect(router.size()).toBe(12);
  });

  it("twelve panes: one chunk for terminal 5 calls one reader once, not twelve", async () => {
    const calls = new Array(13).fill(0);
    const routes: { stop: () => void }[] = [];
    for (let id = 1; id <= 12; id++) {
      const r = await onTerminalOutputRouted(() => (calls[id] += 1));
      r.route(id);
      routes.push(r);
    }
    fanOut({ items: [chunk(5, 1)] });
    expect(calls.reduce((a, b) => a + b, 0), "reader calls for one chunk").toBe(1);
    expect(calls[5]).toBe(1);
    fanOut({ items: [chunk(3, 2), chunk(5, 3), chunk(3, 4)] });
    expect(calls[3]).toBe(2);
    expect(calls[5]).toBe(2);
    expect(calls.reduce((a, b) => a + b, 0)).toBe(4);
    routes.forEach((r) => r.stop());
    fanOut({ items: [chunk(5, 5)] });
    expect(calls.reduce((a, b) => a + b, 0), "stopped readers get nothing").toBe(4);
  });

  it("an unrouted reader and a plain reader still get every chunk, in order, and routing can change between chunks", async () => {
    const plain: string[] = [];
    const routed: string[] = [];
    const stopPlain = await onTerminalOutput((c) => plain.push(`${c.id}:${c.seq}`));
    const box: { route?: (id: number | null) => void } = {};
    const r = await onTerminalOutputRouted((c) => {
      routed.push(`${c.id}:${c.seq}`);
      if (c.seq === 2) box.route?.(7); // from the next chunk on, only terminal 7
    });
    box.route = r.route;
    fanOut({ items: [chunk(1, 1), chunk(2, 2), chunk(1, 3), chunk(7, 4)] });
    expect(routed).toEqual(["1:1", "2:2", "7:4"]);
    expect(plain).toEqual(["1:1", "2:2", "1:3", "7:4"]);
    r.route(null);
    fanOut({ items: [chunk(4, 5)] });
    expect(routed).toEqual(["1:1", "2:2", "7:4", "4:5"]);
    r.stop();
    r.stop(); // stopping twice is safe
    stopPlain();
    fanOut({ items: [chunk(7, 6)] });
    expect(routed.length).toBe(4);
    expect(plain.length).toBe(5);
  });

  it("a routed reader that throws on one chunk loses that chunk only", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: number[] = [];
    const r = await onTerminalOutputRouted((c) => {
      if (c.seq === 2) throw new Error("bad chunk");
      seen.push(c.seq ?? 0);
    });
    r.route(3);
    fanOut({ items: [chunk(3, 1), chunk(3, 2), chunk(3, 3)] });
    expect(seen).toEqual([1, 3]);
    r.stop();
    quiet.mockRestore();
  });
});
