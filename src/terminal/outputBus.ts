// Perf stream (DT-C243): program output arrives from the window process one event per frame window,
// every pane's chunks of that window together and in arrival order (src-tauri/src/terminal/output_batch.rs).
// Every event is one script run in the web view, so this caps that at one per frame where there was one per
// chunk. Readers still see one chunk at a time, in order, through `onTerminalOutput`; nothing but this file
// knows the shape on the wire.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { OutputEvent } from "./codec";

export const OUTPUT_EVENT = "terminal-output";
export const EXIT_EVENT = "terminal-exit";

/** What one `terminal-output` event carries; on the output channel a terminal's end note comes as `exit`. */
export type OutputBatch = { items: OutputEvent[]; exit?: unknown };

type Reader = (chunk: OutputEvent) => void;
type ExitReader = (exit: unknown) => void;

// Flood memory (DT-C244): the window process sends output, and each terminal's end note after its last
// output, through one channel per page once the page has subscribed, and the events only while no page has.
// An event runs in the page as a script with the whole batch written into it, and under an 8-pane flood the
// heap kept those scripts' text (1.4 GB); a channel hands a large batch over as a response the page parses.
// Every reader of this page shares the one channel. The state lives on the window so a hot-reloaded copy of
// this file keeps feeding the readers an older copy registered. One failed fetch of a channel message stalls
// the channel (Tauri delivers its messages in order); that risk is accepted and noted in DT-C244.
type Bus = {
  readers: Set<Reader>;
  exits: Set<ExitReader>;
  subscribed: Promise<void> | null;
  /** Probes (scripts/prove/live-flood.mjs) set this to count channel batches and time their hand-out. */
  probe?: (batch: OutputBatch, ms: number) => void;
};
const bus: Bus = ((globalThis as { __koluxOutputBus?: Bus }).__koluxOutputBus ??= {
  readers: new Set(),
  exits: new Set(),
  subscribed: null,
});

/** Hands one channel message to this page: its chunks to every output reader, then its end note, if any. */
export function fanOut(batch: OutputBatch | undefined): void {
  const t = bus.probe ? performance.now() : 0;
  for (const reader of [...bus.readers]) eachChunk(batch, reader);
  if (batch?.exit !== undefined) {
    for (const reader of [...bus.exits]) {
      try {
        reader(batch.exit);
      } catch (err) {
        console.error("terminal exit: a reader failed", err);
      }
    }
  }
  if (batch && bus.probe) bus.probe(batch, performance.now() - t);
}

function subscribe(): Promise<void> {
  try {
    const channel = new Channel<OutputBatch>();
    channel.onmessage = fanOut;
    // A window process without the command keeps sending the events, which every reader also listens to.
    return invoke("terminal_output_subscribe", { channel }).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

function join<T>(set: Set<T>, reader: T, unlisten: Promise<UnlistenFn>): Promise<UnlistenFn> {
  set.add(reader);
  bus.subscribed ??= subscribe();
  return Promise.all([unlisten, bus.subscribed]).then(
    ([off]) =>
      () => {
        set.delete(reader);
        off();
      },
    (err) => {
      set.delete(reader);
      throw err;
    },
  );
}

/** Calls `onChunk` once per chunk, in the order the window process read them, until the returned function runs. */
export function onTerminalOutput(onChunk: (chunk: OutputEvent) => void): Promise<UnlistenFn> {
  const reader: Reader = (chunk) => onChunk(chunk);
  return join(bus.readers, reader, listen<OutputBatch>(OUTPUT_EVENT, (e) => eachChunk(e.payload, onChunk)));
}

/**
 * Calls `onExit` once per terminal end note, after that terminal's output already read, until the returned
 * function runs. It gets `{ payload }`, the shape a `terminal-exit` event listener got. Each end note comes
 * either on the channel or as the event, never both.
 */
export function onTerminalExit<T>(onExit: (e: { payload: T }) => void): Promise<UnlistenFn> {
  const reader: ExitReader = (exit) => onExit({ payload: exit as T });
  return join(bus.exits, reader, listen<T>(EXIT_EVENT, (e) => onExit({ payload: e.payload })));
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
