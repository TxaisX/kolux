// DT-C243: one batched output event is handed to readers one chunk at a time, in order.
import { describe, expect, it, vi } from "vitest";
import { chunkBytes, type OutputEvent } from "./codec";
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

// DT-C246: an output batch arrives on the channel as one binary frame; readers see its chunks with their bytes.
describe("a raw frame on the output channel", () => {
  it("fans the frame's chunks out as bytes, in order, and leaves an unreadable buffer out", async () => {
    const { fromChannel } = await import("./outputBus");
    const seen: string[] = [];
    const stop = await onTerminalOutput((c) => seen.push(`${c.id}:${new TextDecoder().decode(c.bytes)}:${c.seq}`));
    const frame = new Uint8Array([
      0x4b, 1, 2, 0, 0, 0,
      7, 0, 0, 0, 1, 3, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0x68, 0x69,
      8, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0x21,
    ]).buffer;
    fanOut(fromChannel(frame));
    fanOut(fromChannel(new Uint8Array([1, 2, 3]).buffer));
    fanOut(fromChannel({ items: [], exit: { id: 7 } }));
    stop();
    expect(seen).toEqual(["7:hi:1", "8:!:2"]);
  });

  // Review of DT-C246: once Tauri falls back to postMessage, a raw body is a plain array of numbers; a view is taken too.
  it("reads a frame that arrives as a number array or as a view, not only as an ArrayBuffer", async () => {
    const { fromChannel } = await import("./outputBus");
    const seen: string[] = [];
    const stop = await onTerminalOutput((c) => seen.push(`${c.id}:${new TextDecoder().decode(chunkBytes(c))}`));
    const frame = [0x4b, 1, 1, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0x68, 0x69];
    fanOut(fromChannel(frame));
    const padded = new Uint8Array([9, 9, 9, ...frame, 9]);
    fanOut(fromChannel(padded.subarray(3, 3 + frame.length)));
    fanOut(fromChannel({ items: [{ id: 7, data: "IQ==", seq: 3 }] }));
    stop();
    expect(seen).toEqual(["7:hi", "7:hi", "7:!"]);
  });
});

// DT-C244 review: a terminal's end note comes on the same channel after its output, and readers get it in that order.
describe("the end note on the output channel", () => {
  it("delivers a large last batch to the output readers before the exit reaches the exit readers", async () => {
    const { onTerminalExit } = await import("./outputBus");
    const log: string[] = [];
    const big = "A".repeat(300 * 1024);
    const stopOut = await onTerminalOutput((c) => log.push(`out ${c.id} ${c.data?.length}`));
    const stopExit = await onTerminalExit<{ id: number }>((e) => log.push(`exit ${e.payload.id}`));
    fanOut({ items: [chunk(4, 1, big)] });
    fanOut({ items: [], exit: { id: 4, code: 0 } });
    fanOut({ items: [chunk(5, 1)], exit: { id: 5, code: 0 } });
    stopOut();
    stopExit();
    fanOut({ items: [], exit: { id: 6, code: 0 } });
    expect(log).toEqual([`out 4 ${big.length}`, "exit 4", "out 5 4", "exit 5"]);
  });
});
