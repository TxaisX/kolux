// DT-C243: one batched output event is handed to readers one chunk at a time, in order.
import { describe, expect, it } from "vitest";
import type { OutputEvent } from "./codec";
import { eachChunk, type OutputBatch } from "./outputBus";

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

  it("delivers nothing for an empty batch or a payload without items", () => {
    let calls = 0;
    eachChunk({ items: [] }, () => calls++);
    eachChunk(undefined, () => calls++);
    eachChunk({ id: 1, data: "YQ==" } as unknown as OutputBatch, () => calls++);
    expect(calls).toBe(0);
  });
});
