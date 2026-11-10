// DT-C243: one batched output event is handed to readers one chunk at a time, in order.
import { describe, expect, it, vi } from "vitest";
import type { OutputEvent } from "./codec";
import { eachChunk, fanOut, onTerminalOutput, type OutputBatch } from "./outputBus";

const chunk = (id: number, seq: number, data = "ZQ=="): OutputEvent => ({ id, data, pane: id * 10, generation: 1, seq });

describe("eachChunk", () => {
  it("delivers every chunk of a batch once, in the batch's order, across panes", () => {
    const batch: OutputBatch = { items: [chunk(1, 1), chunk(2, 1), chunk(1, 2), chunk(3, 9), chunk(2, 2)] };
    const seen: OutputEvent[] = [];
    eachChunk(batch, (c) => seen.push(c));
    expect(seen).toEqual(batch.items);
  });

  it("keeps each chunk's own fields (id, pane, generation, seq, data) for the resync and flow checks", () => {
    const seen: OutputEvent[] = [];
    eachChunk({ items: [{ id: 7, data: "YQ==", pane: 3, generation: 42, seq: 1001 }] }, (c) => seen.push(c));
    expect(seen).toEqual([{ id: 7, data: "YQ==", pane: 3, generation: 42, seq: 1001 }]);
  });

  it("a reader that throws on one chunk loses that chunk only; the rest of the batch still goes", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: number[] = [];
    eachChunk({ items: [chunk(1, 1), chunk(2, 1), chunk(3, 1)] }, (c) => {
      if (c.id === 2) throw new Error("bad chunk");
      seen.push(c.id);
    });
    expect(seen).toEqual([1, 3]);
    expect(quiet).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it("delivers nothing for an empty batch or a payload without items", () => {
    let calls = 0;
    eachChunk({ items: [] }, () => calls++);
    eachChunk(undefined, () => calls++);
    eachChunk({ id: 1, data: "YQ==" } as unknown as OutputBatch, () => calls++);
    expect(calls).toBe(0);
  });
});

// DT-C244: output comes through one channel per page; every reader gets each batch, and an unsubscribed reader none.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (b: unknown) => void = () => {};
  },
  invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

describe("the output channel", () => {
  it("subscribes the page once and fans each batch out to every reader, in order", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const a: number[] = [];
    const b: number[] = [];
    const stopA = await onTerminalOutput((c) => a.push(c.seq ?? 0));
    const stopB = await onTerminalOutput((c) => b.push(c.seq ?? 0));
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "terminal_output_subscribe")).toHaveLength(1);
    fanOut({ items: [chunk(1, 1), chunk(2, 2)] });
    stopA();
    fanOut({ items: [chunk(1, 3)] });
    stopB();
    fanOut({ items: [chunk(1, 4)] });
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2, 3]);
  });
});
