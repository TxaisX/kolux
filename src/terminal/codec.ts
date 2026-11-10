// How terminal bytes cross the Rust/JS border.
// Output is the PTY's own bytes (a multi-byte character split across two chunks is reassembled by
// xterm's own decoder, not lost): on the output channel as a binary frame (DT-C246, outputFrame.ts),
// each chunk's `bytes` a view over it; in the `terminal-output` event, the fallback when no page has
// subscribed, as base64 text in `data`. Input goes back as the string xterm produced; the Rust side
// writes its UTF-8 bytes.

// DT-C245: the engine's own base64 decode, where it has one, makes the bytes in one step; the fallback first
// makes a text copy of the whole chunk and then copies it again byte by byte. Both throw on bad input.
const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;

export function decodeOutput(base64: string): Uint8Array {
  if (fromBase64) return fromBase64.call(Uint8Array, base64);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const decoded = new WeakMap<object, Uint8Array>();
const NONE = new Uint8Array();
/**
 * A chunk's bytes: the frame's own view (DT-C246, no decode at all), else the base64 text decoded once
 * however many readers of the page ask for them (DT-C245: the pane that draws it and the ports item that
 * looks for printed addresses both read every chunk). Readers must not change them.
 */
export function chunkBytes(chunk: { data?: string; bytes?: Uint8Array }): Uint8Array {
  if (chunk.bytes) return chunk.bytes;
  if (chunk.data === undefined) return NONE;
  let bytes = decoded.get(chunk);
  if (!bytes) decoded.set(chunk, (bytes = decodeOutput(chunk.data)));
  return bytes;
}

/**
 * `bytes` for a reader that keeps them past this turn (a hidden pane's queue, the startup gate). A small view
 * over a frame's buffer would pin the whole batch (up to 192 KB) for as long as it is held, so one that is less
 * than a quarter of its buffer is copied; anything larger, or a chunk with its own buffer, is handed back as is.
 */
export function heldBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteLength * 4 < bytes.buffer.byteLength ? bytes.slice() : bytes;
}

/** How many bytes a chunk carries, without decoding base64 (a dropped chunk is still acknowledged). */
export function chunkLength(chunk: { data?: string; bytes?: Uint8Array }): number {
  if (chunk.bytes) return chunk.bytes.length;
  const data = chunk.data ?? "";
  const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - pad;
}

/**
 * One output chunk: `bytes` from the channel's frame, or `data` (base64) from the event; one of the two is set.
 * ORCH-057: `seq` is the session's output count after this chunk (resync.ts drops what a snapshot holds).
 */
export type OutputEvent = { id: number; data?: string; bytes?: Uint8Array; pane?: number | null; generation?: number; seq?: number };

/**
 * TERM-098: whether an output chunk belongs to this pane. By terminal id once known; before the
 * spawn call has answered, by the pane key the chunk was tagged with, so the program's first frame
 * (and its cursor question, which the console waits on) is drawn instead of dropped.
 */
export function forPane(e: { id: number; pane?: number | null }, id: number | null, key: number | undefined): boolean {
  return id === null ? key !== undefined && e.pane === key : e.id === id;
}
export type ExitEvent = { id: number; code: number | null; outcome?: "exited" | "unverifiable" };

// What the pane header says once the program is gone. ORCH-057: an end Kolux could not confirm says so.
export function endedLabel(code: number | null, outcome?: ExitEvent["outcome"]): string {
  if (outcome === "unverifiable") return "ended, outcome unverifiable";
  return code === null ? "ended" : code === 0 ? "ended" : `ended (exit ${code})`;
}
