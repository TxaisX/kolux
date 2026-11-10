// Perf stream (DT-C243): program output arrives from the window process one event per frame window,
// every pane's chunks of that window together and in arrival order (src-tauri/src/terminal/output_batch.rs).
// Every event is one script run in the web view, so this caps that at one per frame where there was one per
// chunk. Readers still see one chunk at a time, in order, through `onTerminalOutput`; nothing but this file
// knows the shape on the wire.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { OutputEvent } from "./codec";

export const OUTPUT_EVENT = "terminal-output";

/** What one `terminal-output` event carries. */
export type OutputBatch = { items: OutputEvent[] };

// Flood memory (DT-C244): the window process sends output through one channel per page once the page has
// subscribed, and the event only while no page has. An event runs in the page as a script with the whole
// batch written into it, and under an 8-pane flood the heap kept those scripts' text (1.4 GB); a channel
// hands a large batch over as a response the page parses. Every reader of this page shares the one channel.
const readers = new Set<(chunk: OutputEvent) => void>();
let subscribed: Promise<void> | null = null;

/** Hands one channel batch to every reader of this page, each in the batch's order. */
export function fanOut(batch: OutputBatch | undefined): void {
  for (const reader of [...readers]) eachChunk(batch, reader);
}

function subscribe(): Promise<void> {
  try {
    const channel = new Channel<OutputBatch>();
    channel.onmessage = fanOut;
    // A window process without the command keeps sending the event, which every reader also listens to.
    return invoke("terminal_output_subscribe", { channel }).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

/** Calls `onChunk` once per chunk, in the order the window process read them, until the returned function runs. */
export function onTerminalOutput(onChunk: (chunk: OutputEvent) => void): Promise<UnlistenFn> {
  const reader = (chunk: OutputEvent) => onChunk(chunk);
  readers.add(reader);
  subscribed ??= subscribe();
  return Promise.all([listen<OutputBatch>(OUTPUT_EVENT, (e) => eachChunk(e.payload, onChunk)), subscribed]).then(
    ([unlisten]) =>
      () => {
        readers.delete(reader);
        unlisten();
      },
    (err) => {
      readers.delete(reader);
      throw err;
    },
  );
}

/**
 * One batch's chunks, in order; an older or malformed payload (no `items`) delivers nothing. A reader that
 * throws on one chunk loses that chunk only: the rest of the batch (other panes' output among it) still goes.
 */
export function eachChunk(batch: OutputBatch | undefined, onChunk: (chunk: OutputEvent) => void): void {
  const items = batch?.items;
  if (!Array.isArray(items)) return;
  for (const chunk of items) {
    try {
      onChunk(chunk);
    } catch (err) {
      console.error("terminal output: a reader failed on one chunk; the rest of the batch still goes", err);
    }
  }
}
