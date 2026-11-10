// TERM-123 (DT-C247): what a pane writes to its program is either typed (a key, a paste, a composed
// character, a mouse report: the user did it) or the terminal's own answer to a question the program asked
// (a focus-in or focus-out report when the focus moves, a cursor-position or device-attributes reply, a mode
// or colour query's answer). Both leave xterm through onData, which does not say which. The core does know:
// its coreService.triggerDataEvent(data, wasUserInput) raises onUserInput right before onData for typed
// data and not for an answer, so a listener on that event tells the next onData apart at the source. The
// terminal service then keeps its "last typed into" time (TERM-123) for typing only: a finished agent whose
// pane the focus merely left is untouched and may sleep. ConPTY turns focus reporting on at start, so
// without this every click away from a finished agent's pane counted as typing into it.
//
// Without that core event (another xterm build), every write counts as typed: the behaviour before this,
// which keeps an agent awake rather than sleeping one that was typed into.
import type { Terminal } from "@xterm/xterm";

type CoreInside = { _core?: { coreService?: { onUserInput?: (listener: () => void) => { dispose(): void } } } };

/** Tells the next onData payload apart: typed by the user, or the terminal's own automatic reply. */
export type InputSource = {
  /** For the onData payload being handled now: true when the user typed it, false for an automatic reply.
   *  Reads and clears the mark the core set, so call it once per onData. */
  take(): boolean;
  /** Whether the core's user-input event was found (else every payload reads as typed). */
  readonly exact: boolean;
  dispose(): void;
};

/** Listens on the terminal core's user-input event; see the header. */
export function trackInputSource(term: Terminal): InputSource {
  const on = (term as unknown as CoreInside)._core?.coreService?.onUserInput;
  if (typeof on !== "function") return { take: () => true, exact: false, dispose: () => {} };
  let typed = false;
  const sub = on(() => {
    typed = true;
  });
  return {
    take: () => {
      const t = typed;
      typed = false;
      return t;
    },
    exact: true,
    dispose: () => sub.dispose(),
  };
}

/** The writes the pane itself answers a program with (the keyboard-protocol query, the OSC 52 read-back): automatic too. */
export const AUTO = { auto: true } as const;
