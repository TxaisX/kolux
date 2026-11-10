// Perf stream (DT-C243): program output arrives from the window process one event per frame window,
// every pane's chunks of that window together and in arrival order (src-tauri/src/terminal/output_batch.rs).
// Every event is one script run in the web view, so this caps that at one per frame where there was one per
// chunk. Readers still see one chunk at a time, in order, through `onTerminalOutput`; nothing but this file
// knows the shape on the wire.
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { OutputEvent } from "./codec";

export const OUTPUT_EVENT = "terminal-output";

/** What one `terminal-output` event carries. */
export type OutputBatch = { items: OutputEvent[] };

/** Calls `onChunk` once per chunk, in the order the window process read them, until the returned function runs. */
export function onTerminalOutput(onChunk: (chunk: OutputEvent) => void): Promise<UnlistenFn> {
  return listen<OutputBatch>(OUTPUT_EVENT, (e) => eachChunk(e.payload, onChunk));
}

/** One batch's chunks, in order; an older or malformed payload (no `items`) delivers nothing. */
export function eachChunk(batch: OutputBatch | undefined, onChunk: (chunk: OutputEvent) => void): void {
  const items = batch?.items;
  if (!Array.isArray(items)) return;
  for (const chunk of items) onChunk(chunk);
}
