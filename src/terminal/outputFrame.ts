// Raw output (DT-C246): the output channel hands a batch over as one binary frame, received here as an
// ArrayBuffer. Each chunk's bytes are a view over that one buffer: nothing is parsed as JSON, nothing is
// base64-decoded, nothing is copied. The layout is fixed by src-tauri/src/terminal/output_frame.rs:
//   magic "K", version 1, u32 chunk count, then per chunk u32 id, u8 flags (bit 0: pane key present),
//   u32 pane, u64 generation, u64 seq, u32 length, the bytes; every number little-endian.
import type { OutputEvent } from "./codec";

export const FRAME_MAGIC = 0x4b;
export const FRAME_VERSION = 1;
const CHUNK_HEADER = 4 + 1 + 4 + 8 + 8 + 4;

/**
 * The chunks of one frame, in order, or undefined for a buffer that is not a whole frame of the known
 * version (a chunk that runs past the end, a wrong magic). A frame holds no end note: that stays JSON.
 */
export function decodeFrame(buf: ArrayBuffer): { items: OutputEvent[] } | undefined {
  if (buf.byteLength < 6) return undefined;
  const view = new DataView(buf);
  if (view.getUint8(0) !== FRAME_MAGIC || view.getUint8(1) !== FRAME_VERSION) return undefined;
  const count = view.getUint32(2, true);
  const items: OutputEvent[] = [];
  let at = 6;
  for (let i = 0; i < count; i++) {
    if (at + CHUNK_HEADER > buf.byteLength) return undefined;
    const id = view.getUint32(at, true);
    const hasPane = (view.getUint8(at + 4) & 1) === 1;
    const pane = view.getUint32(at + 5, true);
    const generation = Number(view.getBigUint64(at + 9, true));
    const seq = Number(view.getBigUint64(at + 17, true));
    const len = view.getUint32(at + 25, true);
    at += CHUNK_HEADER;
    if (at + len > buf.byteLength) return undefined;
    items.push({ id, bytes: new Uint8Array(buf, at, len), pane: hasPane ? pane : null, generation, seq });
    at += len;
  }
  return { items };
}
