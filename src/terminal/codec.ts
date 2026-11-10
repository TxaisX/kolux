// How terminal bytes cross the Rust/JS border.
// Output comes as base64 (the Rust side encodes raw PTY bytes, so a multi-byte character split
// across two chunks is reassembled by xterm's own decoder, not lost). Input goes back as the
// string xterm produced; the Rust side writes its UTF-8 bytes.

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
/**
 * DT-C245: a chunk's bytes, decoded once however many readers of the page ask for them (the pane that draws
 * it and the ports item that looks for printed addresses both read every chunk). Readers must not change them.
 */
export function chunkBytes(chunk: { data: string }): Uint8Array {
  let bytes = decoded.get(chunk);
  if (!bytes) decoded.set(chunk, (bytes = decodeOutput(chunk.data)));
  return bytes;
}

/** ORCH-057: `seq` is the session's output count after this chunk (resync.ts drops what a snapshot holds). */
export type OutputEvent = { id: number; data: string; pane?: number | null; generation?: number; seq?: number };

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
