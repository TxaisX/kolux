// ORCH-057: a pane that fell so far behind that the reader went on without it is answered, at its next
// acknowledgement, with a snapshot (the session's newest output and the output count it covers). The pane
// clears its screen, draws the snapshot, and drops every queued output event the snapshot already holds.

export type Snapshot = { seq: number; data: string };

export function resyncGate() {
  let floor = 0;
  return {
    /** Draw this output event? Events without a count (an older service) always draw. */
    accept(seq: number | undefined): boolean {
      return seq === undefined || seq > floor;
    },
    /** A snapshot arrived: events up to its count are already in it. */
    took(snap: Snapshot) {
      floor = Math.max(floor, snap.seq);
    },
  };
}

/** Clears the pane's screen and scrollback, then draws the snapshot's bytes. */
export function applySnapshot(term: { reset(): void; write(data: Uint8Array): void }, bytes: Uint8Array) {
  term.reset();
  term.write(bytes);
}
