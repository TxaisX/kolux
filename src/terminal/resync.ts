// ORCH-057: a pane that fell so far behind that the reader went on without it is answered, at its next
// acknowledgement, with a snapshot (the session's newest output and the output count it covers). The pane
// clears its screen, draws the snapshot, and drops every queued output event the snapshot already holds.
//
// DT-C248 review 2: the count floor is kept per terminal id. A pane remounted in another cell takes the
// floor of the running terminal it redraws from (terminal_live_history names it); a terminal started in the
// same view afterwards (Restart, Enter after an ended program, a reattach that answered fresh) counts its
// output from zero and must not be measured against the old terminal's floor, or every chunk it printed
// would be dropped until it out-printed the old one and the shell would stay blank.

export type Snapshot = { seq: number; data: string };
/** A running terminal's snapshot with the terminal it belongs to (terminal_live_history). */
export type LiveSnapshot = Snapshot & { id: number };

export function resyncGate() {
  const floors = new Map<number, number>();
  return {
    /** Draw this output event of terminal `id`? Events without a count (an older service) always draw. */
    accept(id: number, seq: number | undefined): boolean {
      return seq === undefined || seq > (floors.get(id) ?? 0);
    },
    /** A snapshot of terminal `id` arrived: its events up to the snapshot's count are already in it. */
    took(id: number, snap: Snapshot) {
      floors.set(id, Math.max(floors.get(id) ?? 0, snap.seq));
    },
  };
}

/** Clears the pane's screen and scrollback, then draws the snapshot's bytes. */
export function applySnapshot(term: { reset(): void; write(data: Uint8Array): void }, bytes: Uint8Array) {
  term.reset();
  term.write(bytes);
}
