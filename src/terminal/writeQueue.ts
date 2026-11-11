// PKG-3 (typing): a pane's writes to its program. TERM-071 sends them one after another, since two
// `terminal_write` calls in flight could land out of order; but chained one by one, every key typed
// while a write was out waited a whole round trip of its own behind the one before it, so under load
// keys queued up one round trip each. Here at most one write is in flight per pane, and the text that
// arrives meanwhile is joined, in order, into the next write, which goes when the one in flight answers.
//
// What is never joined, because the terminal service reads the write as a whole (src-tauri terminal.rs
// `terminal_write`, pty.rs `write_shared`):
// - the terminal's own replies (`auto`, TERM-123): they are not typing, so they go alone;
// - Ctrl+C or Esc on its own: the service marks the agent's coming stop interrupted only when the write
//   is exactly that key (STAT-028, ORCH-055);
// - a write that starts as a colour or light/dark reply (OSC, CSI ? 997;), which Windows turns into key
//   events as a whole (TERM-098);
// - writes for different terminals, or a drop meant for one terminal (`only`, TERM-074) with anything
//   that is not meant for that same one.
// And a joined write stays within one paste chunk, so no write is larger than a paste already sends.

/** The most text one joined write carries (a paste chunk, paste.ts CHUNK). */
export const JOIN_MAX = 64 * 1024;

export type QueuedWrite = {
  /** The terminal the text was typed into, as the pane knew it when the text came. */
  readonly id: number;
  data: string;
  readonly auto: boolean;
  readonly only: number | undefined;
};

type Batch = QueuedWrite & { solo: boolean; done: Promise<void>; settle: () => void };

/** A write the terminal service reads as a whole, which nothing may be joined to or onto. */
export function goesAlone(data: string, auto: boolean): boolean {
  return auto || data === "\x03" || data === "\x1b" || data.startsWith("\x1b]") || data.startsWith("\x1b[?997;");
}

/**
 * `send` delivers one write (the pane's `terminal_write`); `failed` says a refused write out loud, once
 * per write that failed, and the writes after it still go. The promise a write returns settles when the
 * write that carried its text has answered, either way (a paste sends its next chunk then).
 */
export function writeQueue(send: (w: QueuedWrite) => Promise<unknown>, failed: (error: unknown, w: QueuedWrite) => void, joinMax = JOIN_MAX) {
  let flying = false;
  const waiting: Batch[] = [];

  const start = (b: Batch) => {
    flying = true;
    let sent: Promise<unknown>;
    try {
      sent = send(b);
    } catch (e) {
      sent = Promise.reject(e);
    }
    sent.then(
      () => finish(b),
      (e) => {
        try {
          failed(e, b);
        } finally {
          finish(b);
        }
      },
    );
  };

  const finish = (b: Batch) => {
    flying = false;
    // The next write goes before this one's callers hear back, so text they send on is joined after it.
    const next = waiting.shift();
    if (next) start(next);
    b.settle();
  };

  return {
    write(id: number, data: string, auto = false, only?: number): Promise<void> {
      const solo = goesAlone(data, auto);
      const last = waiting[waiting.length - 1];
      if (last && !solo && !last.solo && last.id === id && last.only === only && last.data.length + data.length <= joinMax) {
        last.data += data;
        return last.done;
      }
      let settle!: () => void;
      const done = new Promise<void>((resolve) => (settle = resolve));
      const b: Batch = { id, data, auto, only, solo, done, settle };
      if (flying) waiting.push(b);
      else start(b);
      return done;
    },
    /** Writes waiting behind the one in flight (for tests and diagnostics). */
    get waiting(): number {
      return waiting.length;
    },
  };
}
