import { expect, test } from "vitest";
import { chunkBytes, chunkLength } from "./codec";
import { decodeFrame } from "./outputFrame";

// The same bytes src-tauri/src/terminal/output_frame.rs asserts its encoder produces; a change there is a change here.
const FRAME = [
  0x4b, 1, 2, 0, 0, 0,
  7, 0, 0, 0, 1, 3, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0x68, 0x69,
  4, 3, 2, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

test("DT-C246 a frame from the window process decodes to its chunks, in order, as views over the one buffer", () => {
  const buf = new Uint8Array(FRAME).buffer;
  const batch = decodeFrame(buf);
  expect(batch?.items).toHaveLength(2);
  const [a, b] = batch!.items;
  expect(a).toMatchObject({ id: 7, pane: 3, generation: 2, seq: 0x1_0000_0001 });
  expect(new TextDecoder().decode(a.bytes)).toBe("hi");
  expect(a.bytes!.buffer).toBe(buf);
  expect(b).toMatchObject({ id: 0x01020304, pane: null, generation: 1, seq: 5 });
  expect(b.bytes!.length).toBe(0);
  // Readers get the bytes without a decode, and the same object every time.
  expect(chunkBytes(a)).toBe(a.bytes);
  expect(chunkLength(a)).toBe(2);
  expect(chunkLength({ data: btoa("hi") })).toBe(2);
});

test("DT-C246 a frame that is not whole, or not a frame, delivers nothing rather than wrong chunks", () => {
  expect(decodeFrame(new Uint8Array(FRAME.slice(0, FRAME.length - 1)).buffer)).toBeUndefined();
  expect(decodeFrame(new Uint8Array(FRAME.slice(0, 20)).buffer)).toBeUndefined();
  expect(decodeFrame(new Uint8Array([...FRAME, 0]).buffer), "trailing bytes").toBeUndefined();
  expect(decodeFrame(new Uint8Array([0x4b, 2, 0, 0, 0, 0]).buffer)).toBeUndefined();
  expect(decodeFrame(new Uint8Array([0x4a, 1, 0, 0, 0, 0]).buffer)).toBeUndefined();
  expect(decodeFrame(new Uint8Array([0x4b, 1, 0, 0, 0, 0]).buffer)).toEqual({ items: [] });
});

test("DT-C246 a split multi-byte character is carried as the exact bytes", () => {
  const first = [0x6b, 0x6f, 0xc3];
  const frame = [0x4b, 1, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, ...first];
  const batch = decodeFrame(new Uint8Array(frame).buffer)!;
  expect([...batch.items[0].bytes!]).toEqual(first);
});
