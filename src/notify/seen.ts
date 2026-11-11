// STAT-049 / T-125: looking at a finished session marks it seen. A marked pane in view of a focused
// window (the main grid: `inView` answers for it) is acknowledged by itself,
// unless the user marked it unread on purpose; a pane whose status has not arrived yet keeps being
// watched and is acknowledged once its status shows up; a turn stamped later than the local clock
// is acknowledged exactly once (the acknowledgement is remembered by pane and stamp, never by time).

import { sameDir } from "../workspaces";

export type SeenInput = {
  unread: Iterable<number>;
  inView: (key: number) => boolean;
  focused: boolean;
  /** Panes the user marked unread by hand: they stay unread until unmarked. */
  manual: ReadonlySet<number>;
  /** The stamp of the pane's latest turn, or undefined while no status has arrived. */
  stampOf: (key: number) => number | undefined;
  /** Acknowledgements already made, as ackKey() strings. */
  acked: ReadonlySet<string>;
};

export function ackKey(key: number, at: number): string {
  return `${key}@${at}`;
}

/** The panes whose unread mark clears now, with the acknowledgements to remember. */
export function toAcknowledge(i: SeenInput): { panes: number[]; acks: string[] } {
  const panes: number[] = [];
  const acks: string[] = [];
  if (!i.focused) return { panes, acks };
  for (const k of i.unread) {
    if (i.manual.has(k) || !i.inView(k)) continue;
    const at = i.stampOf(k);
    if (at === undefined) continue; // status not here yet: keep watching
    const ack = ackKey(k, at);
    if (i.acked.has(ack)) continue; // a future-stamped turn is acknowledged once
    panes.push(k);
    acks.push(ack);
  }
  return { panes, acks };
}

/** A pane marked unread again by a new note: its earlier acknowledgements go, so looking at it clears the new
 *  mark (a second bell or an exit keeps the turn stamp of the finish already acknowledged). */
export function forgetAcks(acked: Set<string>, key: number): void {
  for (const a of [...acked]) if (a.startsWith(`${key}@`)) acked.delete(a);
}

/** The workspace folders whose unread dot goes when panes `leaving` stop being unread (looked at, or closed): a
 *  leaving unread pane's folder, unless another unread pane that stays is in the same folder. */
export function dirsToClear(panes: ReadonlyArray<{ key: number; cwd: string | null }>, unread: ReadonlySet<number>, leaving: Iterable<number>): string[] {
  const gone = new Set(leaving);
  const stays = panes.filter((p) => unread.has(p.key) && !gone.has(p.key) && p.cwd !== null).map((p) => p.cwd as string);
  const out: string[] = [];
  for (const p of panes) {
    if (!gone.has(p.key) || !unread.has(p.key) || p.cwd === null) continue;
    if (stays.some((d) => sameDir(d, p.cwd)) || out.some((d) => sameDir(d, p.cwd))) continue;
    out.push(p.cwd);
  }
  return out;
}
